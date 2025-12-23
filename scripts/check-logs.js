const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

const client = new CloudWatchLogsClient({ region: 'eu-west-2' });

async function main() {
  const logGroupName = process.argv[2] || '/aws/lambda/repricing-v2-order-backfill';
  const now = Date.now();
  const tenMinutesAgo = now - 10 * 60 * 1000;

  try {
    const result = await client.send(new FilterLogEventsCommand({
      logGroupName,
      startTime: tenMinutesAgo,
      limit: 100,
    }));

    console.log(`Log group: ${logGroupName}`);
    console.log(`Found ${result.events?.length || 0} log events\n`);

    for (const event of result.events || []) {
      const timestamp = new Date(event.timestamp).toISOString();
      console.log(`[${timestamp}] ${event.message}`);
    }
  } catch (error) {
    console.error('Error fetching logs:', error.message);
  }
}

main();
