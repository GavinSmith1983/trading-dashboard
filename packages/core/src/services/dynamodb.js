"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBService = void 0;
exports.createDynamoDBService = createDynamoDBService;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
/**
 * DynamoDB service for all database operations
 */
class DynamoDBService {
    docClient;
    productsTable;
    rulesTable;
    proposalsTable;
    channelsTable;
    ordersTable;
    constructor(config) {
        const client = new client_dynamodb_1.DynamoDBClient({});
        this.docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(client, {
            marshallOptions: { removeUndefinedValues: true },
        });
        this.productsTable = config.productsTable;
        this.rulesTable = config.rulesTable;
        this.proposalsTable = config.proposalsTable;
        this.channelsTable = config.channelsTable;
        this.ordersTable = config.ordersTable || 'repricing-orders';
    }
    // ============ Products ============
    async getProduct(sku) {
        const result = await this.docClient.send(new lib_dynamodb_1.GetCommand({
            TableName: this.productsTable,
            Key: { sku },
        }));
        return result.Item || null;
    }
    async putProduct(product) {
        await this.docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: this.productsTable,
            Item: { ...product, lastUpdated: new Date().toISOString() },
        }));
    }
    async getAllProducts() {
        const products = [];
        let lastKey;
        do {
            const result = await this.docClient.send(new lib_dynamodb_1.ScanCommand({
                TableName: this.productsTable,
                ExclusiveStartKey: lastKey,
            }));
            if (result.Items) {
                products.push(...result.Items);
            }
            lastKey = result.LastEvaluatedKey;
        } while (lastKey);
        return products;
    }
    async batchPutProducts(products) {
        const timestamp = new Date().toISOString();
        // DynamoDB batch write limit is 25 items
        const chunks = this.chunkArray(products, 25);
        for (const chunk of chunks) {
            await this.docClient.send(new lib_dynamodb_1.BatchWriteCommand({
                RequestItems: {
                    [this.productsTable]: chunk.map((product) => ({
                        PutRequest: {
                            Item: { ...product, lastUpdated: timestamp },
                        },
                    })),
                },
            }));
        }
    }
    async getProductsByBrand(brand) {
        const result = await this.docClient.send(new lib_dynamodb_1.QueryCommand({
            TableName: this.productsTable,
            IndexName: 'by-brand',
            KeyConditionExpression: 'brand = :brand',
            ExpressionAttributeValues: { ':brand': brand },
        }));
        return result.Items || [];
    }
    // ============ Pricing Rules ============
    async getRule(ruleId) {
        const result = await this.docClient.send(new lib_dynamodb_1.GetCommand({
            TableName: this.rulesTable,
            Key: { ruleId },
        }));
        return result.Item || null;
    }
    async putRule(rule) {
        await this.docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: this.rulesTable,
            Item: { ...rule, updatedAt: new Date().toISOString() },
        }));
    }
    async getAllRules() {
        const result = await this.docClient.send(new lib_dynamodb_1.ScanCommand({
            TableName: this.rulesTable,
        }));
        return (result.Items || []).sort((a, b) => a.priority - b.priority);
    }
    async deleteRule(ruleId) {
        const { DeleteCommand } = await Promise.resolve().then(() => __importStar(require('@aws-sdk/lib-dynamodb')));
        await this.docClient.send(new DeleteCommand({
            TableName: this.rulesTable,
            Key: { ruleId },
        }));
    }
    // ============ Proposals ============
    async getProposal(proposalId) {
        const result = await this.docClient.send(new lib_dynamodb_1.GetCommand({
            TableName: this.proposalsTable,
            Key: { proposalId },
        }));
        return result.Item || null;
    }
    async putProposal(proposal) {
        await this.docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: this.proposalsTable,
            Item: proposal,
        }));
    }
    async batchPutProposals(proposals) {
        const chunks = this.chunkArray(proposals, 25);
        for (const chunk of chunks) {
            await this.docClient.send(new lib_dynamodb_1.BatchWriteCommand({
                RequestItems: {
                    [this.proposalsTable]: chunk.map((proposal) => ({
                        PutRequest: { Item: proposal },
                    })),
                },
            }));
        }
    }
    async getProposalsByStatus(status) {
        const result = await this.docClient.send(new lib_dynamodb_1.QueryCommand({
            TableName: this.proposalsTable,
            IndexName: 'by-status',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':status': status },
            ScanIndexForward: false, // Most recent first
        }));
        return result.Items || [];
    }
    async queryProposals(filters, page = 1, pageSize = 50) {
        // Build filter expression
        const filterExpressions = [];
        const expressionAttributeNames = {};
        const expressionAttributeValues = {};
        if (filters.status) {
            const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
            if (statuses.length === 1) {
                filterExpressions.push('#status = :status');
                expressionAttributeNames['#status'] = 'status';
                expressionAttributeValues[':status'] = statuses[0];
            }
        }
        if (filters.brand) {
            filterExpressions.push('brand = :brand');
            expressionAttributeValues[':brand'] = filters.brand;
        }
        if (filters.batchId) {
            filterExpressions.push('batchId = :batchId');
            expressionAttributeValues[':batchId'] = filters.batchId;
        }
        if (filters.hasWarnings) {
            filterExpressions.push('size(warnings) > :zero');
            expressionAttributeValues[':zero'] = 0;
        }
        const result = await this.docClient.send(new lib_dynamodb_1.ScanCommand({
            TableName: this.proposalsTable,
            FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
            ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
            ExpressionAttributeValues: Object.keys(expressionAttributeValues).length > 0 ? expressionAttributeValues : undefined,
        }));
        let items = result.Items || [];
        // Apply search filter (client-side for simplicity)
        if (filters.searchTerm) {
            const term = filters.searchTerm.toLowerCase();
            items = items.filter((p) => p.sku.toLowerCase().includes(term) ||
                p.productTitle.toLowerCase().includes(term));
        }
        // Sort by createdAt descending
        items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        // Paginate
        const totalCount = items.length;
        const startIndex = (page - 1) * pageSize;
        const paginatedItems = items.slice(startIndex, startIndex + pageSize);
        return {
            items: paginatedItems,
            totalCount,
            page,
            pageSize,
            hasMore: startIndex + pageSize < totalCount,
        };
    }
    async updateProposalStatus(proposalId, status, reviewedBy, notes, approvedPrice) {
        const updateExpressions = [
            '#status = :status',
            'reviewedAt = :reviewedAt',
            'reviewedBy = :reviewedBy',
        ];
        const expressionAttributeNames = { '#status': 'status' };
        const expressionAttributeValues = {
            ':status': status,
            ':reviewedAt': new Date().toISOString(),
            ':reviewedBy': reviewedBy,
        };
        if (notes) {
            updateExpressions.push('reviewNotes = :notes');
            expressionAttributeValues[':notes'] = notes;
        }
        if (approvedPrice !== undefined) {
            updateExpressions.push('approvedPrice = :approvedPrice');
            expressionAttributeValues[':approvedPrice'] = approvedPrice;
        }
        await this.docClient.send(new lib_dynamodb_1.UpdateCommand({
            TableName: this.proposalsTable,
            Key: { proposalId },
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
        }));
    }
    // ============ Channels ============
    async getChannel(channelId) {
        const result = await this.docClient.send(new lib_dynamodb_1.GetCommand({
            TableName: this.channelsTable,
            Key: { channelId },
        }));
        return result.Item || null;
    }
    async putChannel(channel) {
        await this.docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: this.channelsTable,
            Item: { ...channel, lastUpdated: new Date().toISOString() },
        }));
    }
    async getAllChannels() {
        const result = await this.docClient.send(new lib_dynamodb_1.ScanCommand({
            TableName: this.channelsTable,
        }));
        return result.Items || [];
    }
    // ============ Orders ============
    async batchPutOrders(orders) {
        const chunks = this.chunkArray(orders, 25);
        for (const chunk of chunks) {
            await this.docClient.send(new lib_dynamodb_1.BatchWriteCommand({
                RequestItems: {
                    [this.ordersTable]: chunk.map((order) => ({
                        PutRequest: { Item: order },
                    })),
                },
            }));
        }
    }
    async getOrdersByDate(dateDay) {
        const result = await this.docClient.send(new lib_dynamodb_1.QueryCommand({
            TableName: this.ordersTable,
            IndexName: 'by-date',
            KeyConditionExpression: 'orderDateDay = :dateDay',
            ExpressionAttributeValues: { ':dateDay': dateDay },
        }));
        return result.Items || [];
    }
    async getOrdersByChannel(channelName, fromDate, toDate) {
        const result = await this.docClient.send(new lib_dynamodb_1.QueryCommand({
            TableName: this.ordersTable,
            IndexName: 'by-channel',
            KeyConditionExpression: 'channelName = :channel AND orderDate BETWEEN :fromDate AND :toDate',
            ExpressionAttributeValues: {
                ':channel': channelName,
                ':fromDate': fromDate,
                ':toDate': toDate,
            },
        }));
        return result.Items || [];
    }
    async getOrderCount() {
        const result = await this.docClient.send(new lib_dynamodb_1.ScanCommand({
            TableName: this.ordersTable,
            Select: 'COUNT',
        }));
        return result.Count || 0;
    }
    // ============ Utilities ============
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}
exports.DynamoDBService = DynamoDBService;
/**
 * Create DynamoDB service from environment variables
 */
function createDynamoDBService() {
    return new DynamoDBService({
        productsTable: process.env.PRODUCTS_TABLE || 'repricing-products',
        rulesTable: process.env.PRICING_RULES_TABLE || 'repricing-rules',
        proposalsTable: process.env.PRICE_PROPOSALS_TABLE || 'repricing-proposals',
        channelsTable: process.env.CHANNEL_CONFIG_TABLE || 'repricing-channels',
        ordersTable: process.env.ORDERS_TABLE || 'repricing-orders',
    });
}
//# sourceMappingURL=dynamodb.js.map