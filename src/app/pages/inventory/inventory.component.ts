import { Component, OnInit, ViewChild, HostListener } from '@angular/core';
import { ColDef } from 'ag-grid-community';
import { GridComponent } from '../../components/grid/grid.component';
import { MatButtonModule } from '@angular/material/button';
import { TitleService } from '../../components/header/title.service';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CognitoIdentityProviderClient, GetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import outputs from '../../../../amplify_outputs.json';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LoadingSpinnerComponent } from '../../components/loader/loading-spinner.component';
import { MatDialog } from '@angular/material/dialog';
import { InventoryDeleteConfirmationDialogComponent } from './inventory-delete-confirmation-dialogue.component';
import { MatDialogModule } from '@angular/material/dialog';
import { AddInventoryModalComponent } from '../../components/add-inventory-modal/add-inventory-modal.component';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { RequestStockModalComponent } from 'app/components/request-stock-modal/request-stock-modal.component';
import { MatNativeDateModule } from '@angular/material/core';
import { Router } from '@angular/router';
import { UploadItemsModalComponent } from 'app/components/upload-items-modal/upload-items-modal.component';
import { InventoryService } from '../../../../amplify/services/inventory.service';
import { TeamsService } from '../../../../amplify/services/teams.service';
import { SuppliersService } from '../../../../amplify/services/suppliers.service';
import { ScanQrcodeModalComponent } from 'app/components/scan-qrcode-modal/scan-qrcode-modal.component';

import {
    MatSnackBar,
    MatSnackBarModule,
} from '@angular/material/snack-bar';

@Component({
    selector: 'app-inventory',
    standalone: true,
    imports: [
        GridComponent,
        MatButtonModule,
        CommonModule,
        FormsModule,
        LoadingSpinnerComponent,
        MatDialogModule,
        InventoryDeleteConfirmationDialogComponent,
        AddInventoryModalComponent,
        RequestStockModalComponent,
        MatNativeDateModule,
        MatDatepickerModule,
        MatSnackBarModule,
        UploadItemsModalComponent,
    ],
    templateUrl: './inventory.component.html',
    styleUrls: ['./inventory.component.css'],
})
export class InventoryComponent implements OnInit {
    @ViewChild('gridComponent') gridComponent!: GridComponent;

    rowData: any[] = [];
    isLoading = true;
    suppliers: any[] = [];
    userName: string = '';
    userRole: string = '';
    tenantId: string = '';
    isMobileView: boolean = false;

    colDefs: ColDef[] = [
        {
            field: 'inventoryID',
            headerName: 'Inventory ID',
            hide: true,
            headerTooltip: 'Unique identifier for inventory item',
        },
        {
            field: 'sku',
            headerName: 'SKU',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Stock Keeping Unit',
        },
        {
            field: 'upc',
            headerName: 'Universal Product Code',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Barcode symbology used for tracking trade items',
        },
        {
            field: 'description',
            headerName: 'Description',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Detailed description of the product',
        },
        {
            field: 'category',
            headerName: 'Category',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Product category or classification',
        },
        {
            field: 'quantity',
            headerName: 'Quantity',
            filter: 'agSetColumnFilter',
            editable: true,
            headerTooltip: 'Current stock quantity',
            cellEditor: 'agNumberCellEditor',
            cellEditorParams: {
                min: 0,
                precision: 0
            },
            valueSetter: (params) => {
                const newValue = params.newValue;
                if (newValue < 0) {
                    this.snackBar.open('Quantity must be greater than zero', 'Close', { duration: 3000 });
                    return false;
                }
                return true;
            }
        },
        {
            field: 'supplier',
            headerName: 'Supplier',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Name of the product supplier',
        },
        {
            field: 'expirationDate',
            headerName: 'Expiration Date',
            editable: true,
            cellEditor: 'agDateStringCellEditor',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Date when the product expires',
            valueFormatter: (params) => {
                if (params.value) {
                    const date = new Date(params.value);
                    return date.toISOString().split('T')[0];
                }
                return '';
            },
            valueParser: (params) => {
                if (params.newValue) {
                    const date = new Date(params.newValue);
                    const currentDate = new Date();
                    currentDate.setHours(0, 0, 0, 0);
                    if (date < currentDate) {
                        this.snackBar.open('Expiration date must be in the future', 'Close', { duration: 3000 });
                        return null;
                    }
                    return date.toISOString();
                }
                return null;
            },
            cellStyle: (params) => {
                if (params.value) {
                    const expirationDate = new Date(params.value);
                    const currentDate = new Date();
                    currentDate.setHours(0, 0, 0, 0);
                    
                    const oneWeekFromNow = new Date(currentDate);
                    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);

                    if (expirationDate < currentDate) {
                        return { backgroundColor: '#FFCDD2' }; // Light red for expired items
                    } else if (expirationDate <= oneWeekFromNow) {
                        return { backgroundColor: '#FFF9C4' }; // Light yellow for items expiring within a week
                    } else {
                        return { backgroundColor: '#C8E6C9' }; // Light green for items expiring in more than a week
                    }
                }
                return null;
            },
        },
        {
            field: 'unitCost',
            headerName: 'Unit Cost',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Cost per unit of the product',
        },
        {
            field: 'leadTime',
            headerName: 'Lead Time',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Time between order placement and delivery',
        },
        {
            field: 'deliveryCost',
            headerName: 'Delivery Cost',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Cost of delivering the product',
        },
        {
            field: 'lowStockThreshold',
            headerName: 'Low Stock Threshold',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Minimum quantity before reordering',
        },
        {
            field: 'reorderAmount',
            headerName: 'Reorder Amount',
            filter: 'agSetColumnFilter',
            headerTooltip: 'Quantity to order when restocking',
        },
    ];
    addButton = { text: 'Add New Item' };

    constructor(
        private titleService: TitleService,
        private dialog: MatDialog,
        private snackBar: MatSnackBar,
        private router: Router,
        private inventoryService: InventoryService,
        private teamService: TeamsService,
        private suppliersService: SuppliersService,
    ) {
        Amplify.configure(outputs);
    }

    async ngOnInit(): Promise<void> {
        this.titleService.updateTitle('Inventory');
        this.checkScreenSize();
        await this.getUserInfo();
        this.isLoading = false;
        if (!this.isMobileView) {
            await this.loadInventoryData();
            await this.loadSuppliers();
        }
    }

    @HostListener('window:resize', ['$event'])
    onResize(event: any) {
        const wasMobileView = this.isMobileView;
        this.checkScreenSize();

        // If switching from mobile to desktop view, load data
        if (wasMobileView && !this.isMobileView) {
            this.titleService.updateTitle('Inventory');
            this.loadInventoryData();
            this.loadSuppliers();
        }
    }

    checkScreenSize() {
        const wasMobileView = this.isMobileView;
        this.isMobileView = window.innerWidth <= 768;

        // If switching from desktop to mobile view, clear data
        if (!wasMobileView && this.isMobileView) {
            this.titleService.updateTitle('Request Stock');
            this.rowData = [];
            this.suppliers = [];
        }
    }

    openScanQRCodeModal() {
        const dialogRef = this.dialog.open(ScanQrcodeModalComponent, {
            width: '90%',
            maxWidth: '400px',
            height: 'auto',
            maxHeight: '80vh',
        });

        dialogRef.afterClosed().subscribe((result) => {
            if (result) {
                this.handleQRCodeScan(result);
            }
        });
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
            const familyName = getUserResponse.UserAttributes?.find((attr) => attr.Name === 'family_name')?.Value || '';
            this.userName = `${givenName} ${familyName}`.trim();

            this.tenantId =
                getUserResponse.UserAttributes?.find((attr) => attr.Name === 'custom:tenentId')?.Value || '';

            // Use the InventoryService to get users
            const users = await this.teamService.getUsers(outputs.auth.user_pool_id, this.tenantId).toPromise();

            const currentUser = users.find(
                (user: any) =>
                    user.Attributes.find((attr: any) => attr.Name === 'email')?.Value ===
                    session.tokens?.accessToken.payload['username'],
            );

            if (currentUser && currentUser.Groups.length > 0) {
                this.userRole = this.getRoleDisplayName(currentUser.Groups[0].GroupName);
            }
        } catch (error) {
            console.error('Error fetching user info:', error);
            this.snackBar.open('Error fetching user info', 'Close', {
                duration: 5000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
            });
        }
    }

    private getRoleDisplayName(roleName: string): string {
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

    async loadInventoryData() {
        this.isLoading = true;
        try {
            const inventoryItems = await this.inventoryService.getInventoryItems(this.tenantId).toPromise();
            this.rowData = inventoryItems.map((item: any) => ({
                inventoryID: item.inventoryID,
                sku: item.SKU,
                category: item.category,
                upc: item.upc,
                description: item.description,
                quantity: item.quantity,
                supplier: item.supplier,
                expirationDate: item.expirationDate,
                lowStockThreshold: item.lowStockThreshold,
                reorderAmount: item.reorderAmount,
                unitCost: item.unitCost,
                leadTime: item.leadTime,
                deliveryCost: item.deliveryCost,
                dailyDemand: item.dailyDemand,
                qrCode: item.qrCode,
            }));
            console.log('Processed inventory items:', this.rowData);

            await this.logActivity('Viewed inventory', 'Inventory navigated');
        } catch (error) {
            console.error('Error in loadInventoryData:', error);
            this.rowData = [];
            this.snackBar.open('No Inventory Items have been added', 'Close', {
                duration: 5000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
            });
        } finally {
            this.isLoading = false;
        }
    }

    async loadSuppliers() {
        try {
            this.suppliers = await this.suppliersService.getSuppliers(this.tenantId).toPromise();
            console.log('Suppliers loaded:', this.suppliers);
        } catch (error) {
            console.error('Error in loadSuppliers:', error);
            this.suppliers = [];
            this.snackBar.open('No suppliers have been added', 'Close', {
                duration: 5000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
            });
        }
    }

    openAddItemPopup() {
        const dialogRef = this.dialog.open(AddInventoryModalComponent, {
            width: '600px',
            data: { suppliers: this.suppliers, tenentId: this.tenantId },
        });

        dialogRef.afterClosed().subscribe((result) => {
            if (result) {
                this.onSubmit(result);
            }
        });
    }

    async onSubmit(formData: any) {
        try {
            const payload = {
                upc: formData.upc,
                description: formData.description,
                category: formData.category,
                quantity: formData.quantity,
                sku: formData.sku,
                supplier: formData.supplier,
                lowStockThreshold: formData.lowStockThreshold,
                reorderAmount: formData.reorderAmount,
                tenentId: this.tenantId,
                expirationDate: formData.expirationDate,
                unitCost: formData.unitCost,
                dailyDemand: formData.dailyDemand,
                leadTime: formData.leadTime,
                deliveryCost: formData.deliveryCost,
            };

            console.log('Payload:', payload);

            const response = await this.inventoryService.createInventoryItem(payload).toPromise();

            if (response && response.inventoryID) {
                console.log('Inventory item added successfully');
                await this.logActivity('Added new inventory item', formData.upc + ' was added.');
                await this.loadInventoryData();
                this.snackBar.open('Inventory item added successfully', 'Close', {
                    duration: 3000,
                    horizontalPosition: 'center',
                    verticalPosition: 'top',
                });
            } else {
                throw new Error('Failed to add inventory item');
            }
        } catch (error) {
            console.error('Error:', (error as Error).message);
            this.snackBar.open(`Error: ${(error as Error).message}`, 'Close', {
                duration: 5000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
            });
        }
    }

    handleRowsToDelete(rows: any[]) {
        if (rows.length > 0) {
            const dialogRef = this.dialog.open(InventoryDeleteConfirmationDialogComponent, {
                width: '300px',
                data: { sku: rows[0].sku },
            });

            dialogRef.componentInstance.deleteConfirmed.subscribe(async () => {
                for (const row of rows) {
                    await this.deleteInventoryItem(row.inventoryID);
                }
                this.gridComponent.removeConfirmedRows(rows);
                await this.loadInventoryData();
            });
        }
    }

    async deleteInventoryItem(inventoryID: string) {
        try {
            const response = await this.inventoryService.removeInventoryItem(inventoryID, this.tenantId).toPromise();

            console.log('Inventory item deleted successfully');
            await this.logActivity('Deleted inventory item', inventoryID + ' was deleted.');

            // Show success message using snackbar
            this.snackBar.open('Inventory item deleted successfully', 'Close', {
                duration: 3000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
            });

            // Refresh the inventory data
            await this.loadInventoryData();
        } catch (error) {
            console.error('Error deleting inventory item:', error);

            // Show error message using snackbar
            this.snackBar.open('Error deleting inventory item: ' + (error as Error).message, 'Close', {
                duration: 5000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
            });
        }
    }

    async handleCellValueChanged(event: { data: any; field: string; newValue: any }) {
        try {
            if (event.field === 'quantity' && event.newValue < 0) {
                throw new Error('Quantity must be greater or equal to zero');
            }

            if (event.field === 'expirationDate') {
                const newDate = new Date(event.newValue);
                const currentDate = new Date();
                currentDate.setHours(0, 0, 0, 0);
                if (newDate < currentDate) {
                    throw new Error('Expiration date must be in the future');
                }
            }

            const updatedData = {
                inventoryID: event.data.inventoryID,
                tenentId: this.tenantId,
                [event.field]: event.newValue,
            };

            const response = await this.inventoryService.updateInventoryItem(updatedData).toPromise();

            console.log('Inventory item updated successfully');
            await this.logActivity('Updated inventory item', event.data.upc + ' was updated.');

            // Update the local data to reflect the change
            const updatedItem = response;
            const index = this.rowData.findIndex((item) => item.inventoryID === updatedItem.inventoryID);
            if (index !== -1) {
                this.rowData[index] = { ...this.rowData[index], ...updatedItem };
            }

            // Show success message using snackbar
            this.snackBar.open('Inventory item updated successfully', 'Close', {
                duration: 3000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
            });
        } catch (error) {
            console.error('Error updating inventory item:', error);

            // Revert the change in the grid
            this.gridComponent.updateRow(event.data);

            // Show error message using snackbar
            this.snackBar.open('Error updating inventory item: ' + (error as Error).message, 'Close', {
                duration: 5000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
            });
        }
    }

    openRequestStockPopup(item: any) {
        const dialogRef = this.dialog.open(RequestStockModalComponent, {
            width: '400px',
            data: {
                sku: item.sku || item.SKU,
                supplier: item.supplier,
                availableQuantity: item.quantity,
            },
        });

        dialogRef.afterClosed().subscribe((result) => {
            if (result) {
                this.requestStock(item, result);
            }
        });
    }

    onViewInventorySummary() {
        this.router.navigate(['/inventory-summary']);
    }

    async requestStock(item: any, quantity: number) {
        try {
            if (quantity > item.quantity) {
                throw new Error('Requested quantity exceeds available stock');
            }

            // Update the inventory
            const updatedQuantity = item.quantity - quantity;
            const updateEvent = {
                data: item,
                field: 'quantity',
                newValue: updatedQuantity,
            };
            await this.handleCellValueChanged(updateEvent);

            // Create the stock request report
            const reportPayload = {
                tenentId: this.tenantId,
                sku: item.sku || item.SKU,
                category: item.category,
                supplier: item.supplier,
                quantityRequested: quantity.toString(),
            };

            console.log('Report Payload:', reportPayload);

            const response = await this.inventoryService.createStockRequest(reportPayload).toPromise();

            console.log('API Response:', response);

            if (response && response.stockRequestId) {
                console.log('Stock request report created successfully');
                await this.logActivity('Requested stock', quantity.toString() + ' of ' + item.sku);
                await this.loadInventoryData();

                this.snackBar.open('Stock requested successfully', 'Close', {
                    duration: 3000,
                    horizontalPosition: 'center',
                    verticalPosition: 'top',
                });
            } else {
                throw new Error('Failed to create stock request report');
            }
        } catch (error) {
            console.error('Error requesting stock:', error);

            this.snackBar.open('Error requesting stock: ' + (error as Error).message, 'Close', {
                duration: 5000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
            });
        }
    }

    async logActivity(task: string, details: string) {
        try {
            const session = await fetchAuthSession();

            const lambdaClient = new LambdaClient({
                region: outputs.auth.aws_region,
                credentials: session.credentials,
            });

            const payload = JSON.stringify({
                tenentId: this.tenantId,
                memberId: this.tenantId, // Assuming memberId is the same as tenantId
                name: this.userName,
                role: this.getRoleDisplayName(session.tokens?.idToken?.payload?.['cognito:groups']?.toString() + ''),
                task: task,
                timeSpent: 0, // You might want to calculate this
                idleTime: 0, // You might want to calculate this
                details: details, // This will not be stored in DynamoDB as per the Lambda function
            });

            const invokeCommand = new InvokeCommand({
                FunctionName: 'userActivity-createItem',
                Payload: new TextEncoder().encode(JSON.stringify({ body: payload })),
            });

            const lambdaResponse = await lambdaClient.send(invokeCommand);
            const responseBody = JSON.parse(new TextDecoder().decode(lambdaResponse.Payload));

            if (responseBody.statusCode === 201) {
                console.log('Activity logged successfully');
            } else {
                throw new Error(responseBody.body);
            }
        } catch (error) {
            console.error('Error logging activity:', error);
        }
    }

    openImportItemsModal() {
        console.log('Opening import items modal');
        const dialogRef = this.dialog.open(UploadItemsModalComponent, {});

        dialogRef.afterClosed().subscribe((result) => {
            if (result) {
                this.loadInventoryData(); // Refresh the inventory list
            }
        });
    }

    handleQRCodeScan(qrCodeData: string | null) {
        if (!qrCodeData) {
            console.log('QR code scan cancelled or failed');
            return;
        }

        try {
            const { inventoryID, tenentId } = JSON.parse(qrCodeData);
            if (inventoryID && tenentId) {
                this.getInventoryItem(inventoryID, tenentId).then((item) => {
                    if (item) {
                        this.openRequestStockPopup(item);
                    } else {
                        this.snackBar.open('Item not found', 'Close', { duration: 3000 });
                    }
                });
            } else {
                throw new Error('Invalid QR code data');
            }
        } catch (error) {
            console.error('Error processing QR code:', error);
            this.snackBar.open('Error processing QR code', 'Close', { duration: 3000 });
        }
    }

    async getInventoryItem(inventoryID: string, tenantId: string) {
        try {
            const item = await this.inventoryService.getInventoryItem(inventoryID, tenantId).toPromise();
            return item;
        } catch (error) {
            console.error('Error fetching inventory item:', error);
            this.snackBar.open('Error fetching inventory item', 'Close', {
                duration: 5000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
            });
            return null;
        }
    }
}