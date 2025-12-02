import { Product, Channel, PricingRule, PriceProposal, ProposalStatus, ProposalFilters, PaginatedProposals, Order } from '../types';
/**
 * DynamoDB service for all database operations
 */
export declare class DynamoDBService {
    private docClient;
    private productsTable;
    private rulesTable;
    private proposalsTable;
    private channelsTable;
    private ordersTable;
    constructor(config: {
        productsTable: string;
        rulesTable: string;
        proposalsTable: string;
        channelsTable: string;
        ordersTable?: string;
    });
    getProduct(sku: string): Promise<Product | null>;
    putProduct(product: Product): Promise<void>;
    getAllProducts(): Promise<Product[]>;
    batchPutProducts(products: Product[]): Promise<void>;
    getProductsByBrand(brand: string): Promise<Product[]>;
    getRule(ruleId: string): Promise<PricingRule | null>;
    putRule(rule: PricingRule): Promise<void>;
    getAllRules(): Promise<PricingRule[]>;
    deleteRule(ruleId: string): Promise<void>;
    getProposal(proposalId: string): Promise<PriceProposal | null>;
    putProposal(proposal: PriceProposal): Promise<void>;
    batchPutProposals(proposals: PriceProposal[]): Promise<void>;
    getProposalsByStatus(status: ProposalStatus): Promise<PriceProposal[]>;
    queryProposals(filters: ProposalFilters, page?: number, pageSize?: number): Promise<PaginatedProposals>;
    updateProposalStatus(proposalId: string, status: ProposalStatus, reviewedBy: string, notes?: string, approvedPrice?: number): Promise<void>;
    getChannel(channelId: string): Promise<Channel | null>;
    putChannel(channel: Channel): Promise<void>;
    getAllChannels(): Promise<Channel[]>;
    batchPutOrders(orders: Order[]): Promise<void>;
    getOrdersByDate(dateDay: string): Promise<Order[]>;
    getOrdersByChannel(channelName: string, fromDate: string, toDate: string): Promise<Order[]>;
    getOrderCount(): Promise<number>;
    private chunkArray;
}
/**
 * Create DynamoDB service from environment variables
 */
export declare function createDynamoDBService(): DynamoDBService;
//# sourceMappingURL=dynamodb.d.ts.map