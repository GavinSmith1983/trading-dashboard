import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

interface FrontendStackV2Props extends cdk.StackProps {
  apiUrl: string;
}

/**
 * V2 Frontend Stack - S3 + CloudFront for the multi-tenant frontend
 */
export class FrontendStackV2 extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly websiteUrl: string;

  constructor(scope: Construct, id: string, props: FrontendStackV2Props) {
    super(scope, id, props);

    // S3 bucket for frontend assets
    this.bucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `repricing-v2-frontend-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // CloudFront Origin Access Identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: 'Repricing V2 Frontend OAI',
    });

    // Grant CloudFront access to S3
    this.bucket.grantRead(originAccessIdentity);

    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: new origins.S3Origin(this.bucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US, Canada, Europe only
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      comment: 'Repricing V2 Frontend Distribution',
    });

    this.websiteUrl = `https://${this.distribution.distributionDomainName}`;

    // ============================================================
    // OUTPUTS
    // ============================================================
    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: this.bucket.bucketName,
      exportName: 'RepricingV2WebsiteBucket',
    });

    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: this.distribution.distributionDomainName,
      exportName: 'RepricingV2DistributionDomain',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      exportName: 'RepricingV2DistributionId',
    });

    new cdk.CfnOutput(this, 'WebsiteUrl', {
      value: this.websiteUrl,
      exportName: 'RepricingV2WebsiteUrl',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: props.apiUrl,
      exportName: 'RepricingV2ApiUrlForFrontend',
      description: 'API URL for frontend configuration',
    });
  }
}
