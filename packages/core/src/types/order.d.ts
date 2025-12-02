/**
 * Order from ChannelEngine API
 */
export interface ChannelEngineOrder {
    Id: number;
    ChannelOrderNo: string;
    ChannelName: string;
    ChannelId: number;
    OrderDate: string;
    Status: string;
    SubTotalInclVat: number;
    SubTotalVat: number;
    ShippingCostsInclVat: number;
    ShippingCostsVat: number;
    TotalInclVat: number;
    TotalVat: number;
    TotalFee: number;
    CurrencyCode: string;
    Lines: ChannelEngineOrderLine[];
}
/**
 * Order line from ChannelEngine API
 */
export interface ChannelEngineOrderLine {
    Id: number;
    ChannelOrderLineNo: string;
    MerchantProductNo: string;
    Description: string;
    Quantity: number;
    UnitPriceInclVat: number;
    UnitPriceExclVat: number;
    LineTotalInclVat: number;
    LineTotalExclVat: number;
    LineVat: number;
    FeeFixed: number;
    FeeRate: number;
    VatRate: number;
    ShippingMethod?: string;
    ShippingServiceLevel?: string;
    Status: string;
    Gtin?: string;
}
/**
 * Order line stored in DynamoDB (nested within Order)
 */
export interface OrderLine {
    lineId: string;
    channelOrderLineNo: string;
    sku: string;
    description: string;
    gtin?: string;
    quantity: number;
    unitPriceInclVat: number;
    unitPriceExclVat: number;
    lineTotalInclVat: number;
    lineTotalExclVat: number;
    lineVat: number;
    vatRate: number;
    feeFixed: number;
    feeRate: number;
    shippingMethod?: string;
    shippingServiceLevel?: string;
    status: string;
}
/**
 * Order stored in DynamoDB (with nested lines)
 */
export interface Order {
    orderId: string;
    channelOrderNo: string;
    channelName: string;
    channelId: number;
    orderDate: string;
    orderDateDay: string;
    status: string;
    subTotalInclVat: number;
    subTotalExclVat: number;
    totalVat: number;
    shippingCostsInclVat: number;
    totalInclVat: number;
    totalFee: number;
    currencyCode: string;
    shippingMethod?: string;
    shippingServiceLevel?: string;
    lines: OrderLine[];
    syncedAt: string;
}
//# sourceMappingURL=order.d.ts.map