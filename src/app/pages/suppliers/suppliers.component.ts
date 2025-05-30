import { Component, OnInit, ViewChild } from '@angular/core';
import { ColDef } from 'ag-grid-community';
import { GridComponent } from '../../components/grid/grid.component';
import { TitleService } from '../../components/header/title.service';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CognitoIdentityProviderClient, GetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import outputs from '../../../../amplify_outputs.json';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, Validators } from '@angular/forms';
import { DeleteConfirmationDialogComponent } from './delete-confirmation-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { LoadingSpinnerComponent } from '../../components/loader/loading-spinner.component';
import { MatDialogModule } from '@angular/material/dialog';
import { ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from 'app/components/material/material.module';
import { UploadSuppliersModalComponent } from 'app/components/upload-suppliers-modal/upload-suppliers-modal.component';
import { TeamsService } from '../../../../amplify/services/teams.service';
import { SuppliersService } from '../../../../amplify/services/suppliers.service';

@Component({
    selector: 'app-suppliers',
    standalone: true,
    imports: [
        GridComponent,
        CommonModule,
        FormsModule,
        DeleteConfirmationDialogComponent,
        LoadingSpinnerComponent,
        MatDialogModule,
        FormsModule,
        ReactiveFormsModule,
        MaterialModule,
    ],
    templateUrl: './suppliers.component.html',
    styleUrl: './suppliers.component.css',
})
export class SuppliersComponent implements OnInit {
    @ViewChild('gridComponent') gridComponent!: GridComponent;
    rowData: any[] = [];
    showAddPopup = false;
    showDeletePopup = false;
    isLoading = true;
    isAddingSupplier = false;
    isEditingAddress = false;
    rowsToDelete: any[] = [];
    showEditAddressPopup = false;
    tenantId: string = '';
    userName: string = '';
    userRole: string = '';
    supplierForm!: FormGroup;
    editAddressForm!: FormGroup;
    selectedSupplier: any;
    createForm() {
        this.supplierForm = this.fb.group({
            company_name: ['', [Validators.required, Validators.minLength(2)]],
            contact_name: ['', [Validators.required, Validators.pattern(/^[a-zA-Z\s-]+$/)]],
            contact_email: ['', [Validators.required, Validators.email]],
            phone_number: [
                '',
                [
                    Validators.required,
                    Validators.pattern(/^\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}$/),
                ],
            ],
            address: this.fb.group({
                street: ['', Validators.required],
                city: ['', Validators.required],
                state_province: ['', Validators.required],
                postal_code: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{3,10}$/i)]],
                country: ['', Validators.required],
            }),
        });
    }

    colDefs: ColDef[] = [
        {
            field: 'supplierID',
            headerName: 'Supplier ID',
            hide: true,
            headerTooltip: 'Unique identifier for each supplier',
        },
        {
            field: 'company_name',
            headerName: 'Company Name',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Name of the supplier company',
        },
        {
            field: 'contact_name',
            headerName: 'Contact Name',
            filter: 'agSetColumnFilter',
            editable: true,
            headerTooltip: 'Name of the primary contact person at the supplier',
            valueParser: (params) => {
                // Remove any non-alphabetic characters except spaces and hyphens
                return params.newValue.replace(/[^a-zA-Z\s-]/g, '');
            },
            valueSetter: (params) => {
                const newValue = params.newValue.trim();
                if (newValue.length >= 2 && /^[a-zA-Z\s-]+$/.test(newValue)) {
                    params.data[params.colDef.field!] = newValue;
                    return true;
                }
                return false;
            },
        },
        {
            field: 'contact_email',
            headerName: 'Contact Email',
            filter: 'agSetColumnFilter',
            editable: true,
            headerTooltip: 'Email address of the primary contact person',
            valueParser: (params) => params.newValue.trim(),
            valueSetter: (params) => {
                const newValue = params.newValue.trim();
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (emailRegex.test(newValue)) {
                    params.data[params.colDef.field!] = newValue;
                    return true;
                }
                return false;
            },
        },
        {
            field: 'phone_number',
            headerName: 'Phone Number',
            filter: 'agSetColumnFilter',
            editable: true,
            headerTooltip: 'Phone number of the supplier or primary contact',
            valueParser: (params) => {
                // Remove any non-digit characters except +, -, (, ), and space
                return params.newValue.replace(/[^\d+\-() ]/g, '');
            },
            valueSetter: (params) => {
                const newValue = params.newValue.trim();
                const phoneRegex = /^\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}$/;
                if (phoneRegex.test(newValue)) {
                    params.data[params.colDef.field!] = newValue;
                    return true;
                }
                return false;
            },
        },
        {
            field: 'address',
            headerName: 'Address',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Physical address of the supplier',
            valueGetter: (params: any) => this.getAddressString(params.data.address),
            onCellClicked: (params: any) => this.onAddressCellClicked(params.data),
        },
    ];

    addButton = { text: 'Add New Supplier' };

    constructor(
        private titleService: TitleService,
        private dialog: MatDialog,
        private snackBar: MatSnackBar,
        private teamService: TeamsService,
        private suppliersService: SuppliersService,
        private fb: FormBuilder,
    ) {
        Amplify.configure(outputs);
        this.createForm();
        this.createEditAddressForm();
    }

    async ngOnInit(): Promise<void> {
        this.titleService.updateTitle('Suppliers');
        await this.getUserInfo();
        await this.loadSuppliersData();
        await this.logActivity('Viewed suppliers', 'Suppliers page navigated');
    }

    async logActivity(task: string, details: string) {
        try {
            const session = await fetchAuthSession();

            const lambdaClient = new LambdaClient({
                region: outputs.auth.aws_region,
                credentials: session.credentials,
            });
  
            const payload = {
                tenentId: this.tenantId,
                memberId: this.tenantId, 
                name: this.userName,
                role: this.getRoleDisplayName(session.tokens?.idToken?.payload?.['cognito:groups']?.toString() + ''),
                task: task,
                timeSpent: 0,   
                idleTime: 0,
                details: details,
            };
            
            const invokeCommand = new InvokeCommand({
                FunctionName: 'userActivityCreateItem',
                Payload: new TextEncoder().encode(
                    JSON.stringify({
                        body: JSON.stringify(payload)  // <<--- this is important
                    })
                ),
            });
              

            const lambdaResponse = await lambdaClient.send(invokeCommand);
            const responseBody = JSON.parse(new TextDecoder().decode(lambdaResponse.Payload));

            if (responseBody.statusCode === 201) {
            console.log('Activity logged successfully');
            } else {
            console.error("Lambda response:", responseBody);
            throw new Error(responseBody.body || "Unknown error from Lambda");
            }

        } catch (error: any) {
            console.error("Error logging activity:", error.message || error, error);
          }
          
    }

    private getRoleDisplayName(roleName: string): string {
        console.log(roleName)
        switch (roleName) {
            case 'admin':
                return 'Admin';
            case 'enduser':
                return 'End User';
            case 'inventorycontroller':
                return 'Inventory Controller';
            default:
                return '';
        }
    }

    async getUserInfo() {
        try {
            const session = await fetchAuthSession();

            const cognitoClient = new CognitoIdentityProviderClient({
                region: outputs.auth.aws_region,
                credentials: session.credentials,
            });

            const getUserCommand = new GetUserCommand({
                AccessToken: session.tokens?.accessToken.toString(),
            });
            const getUserResponse = await cognitoClient.send(getUserCommand);

           
            const givenName = getUserResponse.UserAttributes?.find((attr) => attr.Name === 'given_name')?.Value || '';
            console.log('GivenName:'+givenName);
            const familyName = getUserResponse.UserAttributes?.find((attr) => attr.Name === 'family_name')?.Value || '';
            console.log('familyName: '+familyName);
            this.userName = `${givenName} ${familyName}`.trim();

            this.tenantId = getUserResponse.UserAttributes?.find((attr) => attr.Name === 'custom:tenentId')?.Value || '';
            console.log('tenantid: '+this.tenantId);
            // Use the TeamsService to get users
            const users = await this.teamService.getUsers(outputs.auth.user_pool_id, this.tenantId).toPromise();
           

            const currentUser = users.find(
                (user: any) =>
                    user.Attributes.find((attr: any) => attr.Name === 'email')?.Value ===
                    session.tokens?.accessToken.payload['username'],
            );
            
            if (currentUser && currentUser.Groups.length > 0) {
                 //this.userRole = 'admin';  
                 this.userRole = this.getRoleDisplayName(currentUser.Groups[0].GroupName);
            }
        } catch (error) {
            console.error('Error fetching user info:', error);
            // You might want to add some error handling here, such as showing an error message to the user
            this.snackBar.open('Error fetching user info', 'Close', {
                duration: 5000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
            });
        }
    }

    async loadSuppliersData() {
        try {
            const session = await fetchAuthSession();

            const cognitoClient = new CognitoIdentityProviderClient({
                region: outputs.auth.aws_region,
                credentials: session.credentials,
            });

            const getUserCommand = new GetUserCommand({
                AccessToken: session.tokens?.accessToken.toString(),
            });
            const getUserResponse = await cognitoClient.send(getUserCommand);

            const tenantId = getUserResponse.UserAttributes?.find((attr) => attr.Name === 'custom:tenentId')?.Value;
             console.log('TenentId: '+tenantId);
            if (!tenantId) {
                console.error('TenantId not found in user attributes');
                this.rowData = [];
                return;
            }

            this.suppliersService.getSuppliers(tenantId).subscribe(
                (suppliers) => {
                    this.rowData = suppliers.map((supplier: any) => ({
                        supplierID: supplier.supplierID,
                        company_name: supplier.company_name,
                        contact_name: supplier.contact_name,
                        contact_email: supplier.contact_email,
                        phone_number: supplier.phone_number,
                        address: supplier.address,
                    }));
                    console.log('Processed suppliers:', this.rowData);
                },
                (error) => {
                    console.error('Error fetching suppliers data:', error);
                    this.rowData = [];
                },
            );
        } catch (error) {
            console.error('Error in loadSuppliersData:', error);
            this.rowData = [];
        } finally {
            this.isLoading = false;
        }
    }

    getAddressString(address: any): string {
        return `${address.street}, ${address.city}, ${address.country}, ${address.postal_code}`;
    }

    async openAddSupplierPopup() {
        this.showAddPopup = true;
        await this.logActivity('Opened add supplier popup', 'Initiated adding a new supplier');
    }

    async onAddressCellClicked(supplier: any) {
        this.openEditAddressPopup(supplier);
        await this.logActivity('Opened edit address popup', `Editing address for supplier ${supplier.company_name}`);
    }

    closeAddPopup() {
        this.showAddPopup = false;
        this.supplierForm.reset();
    }

    createEditAddressForm() {
        this.editAddressForm = this.fb.group({
            street: ['', Validators.required],
            city: ['', Validators.required],
            state_province: ['', Validators.required],
            postal_code: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{3,10}$/i)]],
            country: ['', Validators.required],
        });
    }

    openEditAddressPopup(supplier: any) {
        this.selectedSupplier = supplier;
        this.editAddressForm.patchValue(supplier.address);
        this.showEditAddressPopup = true;
    }

    closeEditAddressPopup() {
        this.showEditAddressPopup = false;
        this.selectedSupplier = null;
        this.editAddressForm.reset();
    }

    async onEditAddressSubmit() {
        if (this.editAddressForm.valid) {
            this.isEditingAddress = true;
            try {
                const formData = this.editAddressForm.value;
                console.log('Updated address:', formData);
                const session = await fetchAuthSession();
                const cognitoClient = new CognitoIdentityProviderClient({
                    region: outputs.auth.aws_region,
                    credentials: session.credentials,
                });
                const getUserCommand = new GetUserCommand({
                    AccessToken: session.tokens?.accessToken.toString(),
                });
                const getUserResponse = await cognitoClient.send(getUserCommand);
                const tenantId = getUserResponse.UserAttributes?.find((attr) => attr.Name === 'custom:tenentId')?.Value;
                if (!tenantId) {
                    throw new Error('TenantId not found in user attributes');
                }
                const updatedData = {
                    supplierID: this.selectedSupplier.supplierID,
                    tenentId: tenantId,
                    address: formData,
                };
                console.log('Updated data:', updatedData);
                const response = await this.suppliersService.editSupplier(updatedData).toPromise();
                console.log('API response:', response);
                if (response && response.body) {
                    console.log('Supplier address updated successfully');
                    const updatedSupplier = response.body;
                    await this.logActivity(
                        'Updated supplier address',
                        `Updated address for supplier ${this.selectedSupplier.company_name}`,
                    );
                    this.closeEditAddressPopup();
                    await this.loadSuppliersData();
                    this.snackBar.open('Supplier address updated successfully', 'Close', {
                        duration: 6000,
                        horizontalPosition: 'center',
                        verticalPosition: 'top',
                    });
                } else {
                    throw new Error('Invalid response from server');
                }
            } catch (error) {
                console.error('Error updating supplier address:', error);
                this.snackBar.open(`Error updating supplier address: ${(error as Error).message}`, 'Close', {
                    duration: 6000,
                    horizontalPosition: 'center',
                    verticalPosition: 'top',
                });
            } finally {
                this.isEditingAddress = false;
            }
        } else {
            this.editAddressForm.markAllAsTouched();
        }
    }
    async onSubmit() {
        console.log('Submit clicked');
        
        if (this.supplierForm.valid) {
            const formData = this.supplierForm.value;
            this.isAddingSupplier = true;
    
            try {
                // Fetch session and initialize Cognito client
                const session = await fetchAuthSession();
                if (!session || !session.tokens?.accessToken) {
                    throw new Error('Access token is missing or session is invalid');
                }
    
                const cognitoClient = new CognitoIdentityProviderClient({
                    region: outputs.auth.aws_region,
                    credentials: session.credentials,
                });
    
                // Get user info from Cognito
                const getUserCommand = new GetUserCommand({
                    AccessToken: session.tokens.accessToken.toString(),
                });
                const getUserResponse = await cognitoClient.send(getUserCommand);
    
                // Extract tenant ID from user attributes
                const tenantId = getUserResponse.UserAttributes?.find(
                    (attr) => attr.Name === 'custom:tenentId'
                )?.Value;
    
                if (!tenantId) {
                    throw new Error('TenantId not found in user attributes');
                }
    
                // Prepare the payload for adding the supplier
                const { company_name, contact_name, contact_email, phone_number, address } = formData;
                const payload = {
                    company_name,
                    contact_name,
                    contact_email,
                    phone_number,
                    address: {
                        street: address.street,
                        city: address.city,
                        state_province: address.state_province,
                        postal_code: address.postal_code,
                        country: address.country,
                    },
                };
    
                console.log('Sending payload:', payload);
    
                // Call the supplier service to add the supplier
                const response = await this.suppliersService.addSupplier(payload).toPromise();
                console.log('Received response:', response);
    
                if (response && response.supplierID) {
                    console.log('Supplier added successfully');
                    await this.loadSuppliersData();
                    this.closeAddPopup();
    
                    this.snackBar.open('Supplier added successfully', 'Close', {
                        duration: 6000,
                        horizontalPosition: 'center',
                        verticalPosition: 'top',
                    });
    
                    // Log the activity of adding a new supplier
                    await this.logActivity('Added new supplier', `Added supplier ${company_name}`);
                } else {
                    throw new Error('Failed to add supplier');
                }
    
            } catch (error) {
                // Enhanced error logging with error details
                console.error('Error adding supplier:', error);
    
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                this.snackBar.open(`Error adding supplier: ${errorMessage}`, 'Close', {
                    duration: 6000,
                    horizontalPosition: 'center',
                    verticalPosition: 'top',
                });
    
            } finally {
                this.isAddingSupplier = false;
            }
    
        } else {
            // Trigger validation messages if form is invalid
            this.supplierForm.markAllAsTouched();
        }
    }
    
    async deleteSupplier(supplierID: string) {
        try {
            const session = await fetchAuthSession();
            const cognitoClient = new CognitoIdentityProviderClient({
                region: outputs.auth.aws_region,
                credentials: session.credentials,
            });
            const getUserCommand = new GetUserCommand({
                AccessToken: session.tokens?.accessToken.toString(),
            });
            const getUserResponse = await cognitoClient.send(getUserCommand);
            const tenentId = getUserResponse.UserAttributes?.find((attr) => attr.Name === 'custom:tenentId')?.Value;
            if (!tenentId) {
                throw new Error('TenentId not found in user attributes');
            }

            const response = await this.suppliersService.deleteSupplier(supplierID, tenentId).toPromise();
            console.log('Delete response:', response);

            if (response.message === 'Supplier deleted successfully and notification created') {
                console.log('Supplier deleted successfully');
                this.snackBar.open('Supplier deleted successfully', 'Close', {
                    duration: 3000,
                    horizontalPosition: 'center',
                    verticalPosition: 'top',
                });
                await this.logActivity('Deleted supplier', supplierID + ' was deleted.');
                await this.loadSuppliersData(); // Refresh the supplier list
            } else if (
                response.error === 'Supplier cannot be deleted because they are already being used in the system'
            ) {
                this.snackBar.open(
                    'Supplier cannot be deleted because they are already being used in the system',
                    'Close',
                    {
                        duration: 6000,
                        horizontalPosition: 'center',
                        verticalPosition: 'top',
                    },
                );
            } else {
                throw new Error(response.error || 'Unknown error occurred');
            }
        } catch (error) {
            console.error('Error deleting supplier:', error);
            this.snackBar.open(
                `Supplier cannot be deleted because they are already being used in the system`,
                'Close',
                {
                    duration: 5000,
                    horizontalPosition: 'center',
                    verticalPosition: 'top',
                },
            );
        }
    }

    private updateQueue: { [key: string]: any } = {};
    private updateTimeout: any;

    async handleCellValueChanged(event: { data: any; field: string; newValue: any }) {
        // Add the change to the queue
        if (!this.updateQueue[event.data.supplierID]) {
            this.updateQueue[event.data.supplierID] = {
                supplierID: event.data.supplierID,
                tenentId: this.tenantId,
            };
        }
        this.updateQueue[event.data.supplierID][event.field] = event.newValue;

        // Clear any existing timeout
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }

        // Set a new timeout
        this.updateTimeout = setTimeout(async () => {
            try {
                for (const supplierID in this.updateQueue) {
                    const updatedData = this.updateQueue[supplierID];
                    console.log('Sending updated data:', updatedData);
                    const response = await this.suppliersService.editSupplier(updatedData).toPromise();
                    console.log('Received response:', response);

                    if (response && response.body) {
                        console.log('Supplier updated successfully');
                        const updatedSupplier = response.body;
                        const index = this.rowData.findIndex(
                            (supplier) => supplier.supplierID === updatedSupplier.supplierID,
                        );
                        if (index !== -1) {
                            this.rowData[index] = { ...this.rowData[index], ...updatedSupplier };
                        }
                        await this.logActivity('Updated supplier', `Updated supplier ${updatedSupplier.company_name}`);
                    } else {
                        throw new Error('Invalid response from server');
                    }
                }

                // Show snackbar only once after all updates are complete
                this.snackBar.open('Supplier updated successfully', 'Close', {
                    duration: 6000,
                    horizontalPosition: 'center',
                    verticalPosition: 'top',
                });

                // Clear the update queue
                this.updateQueue = {};
            } catch (error) {
                console.error('Error updating supplier(s):', error);
                this.snackBar.open(`Error updating supplier(s): ${(error as Error).message}`, 'Close', {
                    duration: 6000,
                    horizontalPosition: 'center',
                    verticalPosition: 'top',
                });
                // Revert all changes in the grid
                for (const supplierID in this.updateQueue) {
                    const originalData = this.rowData.find((supplier) => supplier.supplierID === supplierID);
                    if (originalData) {
                        this.gridComponent.updateRow(originalData);
                    }
                }
                // Clear the update queue
                this.updateQueue = {};
            }
        }, 500); // Wait for 500ms before sending updates
    }

    handleRowsToDelete(rows: any[]) {
        this.rowsToDelete = rows;
        this.openDeleteConfirmationDialog();
    }

    openDeleteConfirmationDialog() {
        if (this.rowsToDelete.length > 0) {
            const dialogRef = this.dialog.open(DeleteConfirmationDialogComponent, {
                width: '350px',
                data: {
                    company_name: this.rowsToDelete[0].company_name,
                    contact_email: this.rowsToDelete[0].contact_email,
                },
            });

            dialogRef.componentInstance.deleteConfirmed.subscribe(() => {
                this.confirmDelete();
                dialogRef.close();
            });
        }
    }

    async confirmDelete() {
        if (this.rowsToDelete.length > 0) {
            for (const row of this.rowsToDelete) {
                await this.deleteSupplier(row.supplierID);
            }
            this.gridComponent.removeConfirmedRows(this.rowsToDelete);
            this.rowsToDelete = [];
            await this.loadSuppliersData(); // Refresh the data after deletion
        }
    }

    cancelDelete() {
        this.showDeletePopup = false;
        this.rowsToDelete = [];
    }

    openImportSuppliersModal() {
        console.log('Opening import suppliers modal');
        const dialogRef = this.dialog.open(UploadSuppliersModalComponent, {});

        dialogRef.afterClosed().subscribe((result) => {
            if (result) {
                this.loadSuppliersData(); // Refresh the suppliers list
            }
        });
    }
}
