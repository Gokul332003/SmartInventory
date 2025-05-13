const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
exports.handler = async (event) => {
  console.log(`EVENT: ${JSON.stringify(event)}`);

  // Enable CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*"
  };

  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body);

      const { Username, Email, Verified } = body;

      if (!Username || !Email || Verified === undefined) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ message: "Missing required fields" })
        };
      }

      const params = {
        TableName: "Users", // Match your DynamoDB table name
        Item: {
          Username,
          Email,
          Verified
        }
      };

      await docClient.put(params).promise();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "User added successfully" })
      };

    } catch (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ message: error.message })
      };
    }
  } else {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: `Method ${event.httpMethod} not allowed` })
    };
  }
};
