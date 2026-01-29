import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Dashboard, GraphWidget, Metric, TextWidget } from 'aws-cdk-lib/aws-cloudwatch';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { TaskTitanTable } from './dynamodb';

export interface MonitoringProps {
  /**
   * Name of the application for dashboard title
   */
  readonly applicationName: string;

  /**
   * Lambda functions to monitor
   */
  readonly lambdaFunctions: Array<{ name: string; fn: IFunction }>;

  /**
   * DynamoDB table to monitor
   */
  readonly dynamoTable: TaskTitanTable;
}

/**
 * CloudWatch Monitoring Dashboard
 *
 * Creates a comprehensive monitoring dashboard for the TaskTitan application
 * including Lambda performance, DynamoDB metrics, and error tracking.
 */
export class Monitoring extends Construct {
  public readonly dashboard: Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    const { applicationName, lambdaFunctions, dynamoTable } = props;

    // Create CloudWatch Dashboard
    this.dashboard = new Dashboard(this, 'Dashboard', {
      dashboardName: `${applicationName}-Monitoring`,
    });

    // Title Widget
    this.dashboard.addWidgets(
      new TextWidget({
        markdown: `# ${applicationName} Monitoring Dashboard\n\nReal-time application health and performance metrics`,
        width: 24,
        height: 2,
      }),
    );

    // Lambda Metrics Section
    this.dashboard.addWidgets(
      new TextWidget({
        markdown: '## Lambda Functions',
        width: 24,
        height: 1,
      }),
    );

    // Lambda Invocations
    const invocationMetrics = lambdaFunctions.map(
      ({ name, fn }) =>
        new Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Invocations',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Sum',
          period: Duration.minutes(5),
          label: name,
        }),
    );

    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'Lambda Invocations (5 min)',
        width: 12,
        height: 6,
        left: invocationMetrics,
      }),
    );

    // Lambda Errors
    const errorMetrics = lambdaFunctions.map(
      ({ name, fn }) =>
        new Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Sum',
          period: Duration.minutes(5),
          label: name,
        }),
    );

    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'Lambda Errors (5 min)',
        width: 12,
        height: 6,
        left: errorMetrics,
      }),
    );

    // Lambda Duration
    const durationMetrics = lambdaFunctions.map(
      ({ name, fn }) =>
        new Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Average',
          period: Duration.minutes(5),
          label: name,
        }),
    );

    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'Lambda Duration Average (ms)',
        width: 12,
        height: 6,
        left: durationMetrics,
      }),
    );

    // Lambda Concurrent Executions
    const concurrencyMetrics = lambdaFunctions.map(
      ({ name, fn }) =>
        new Metric({
          namespace: 'AWS/Lambda',
          metricName: 'ConcurrentExecutions',
          dimensionsMap: { FunctionName: fn.functionName },
          statistic: 'Maximum',
          period: Duration.minutes(5),
          label: name,
        }),
    );

    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'Lambda Concurrent Executions',
        width: 12,
        height: 6,
        left: concurrencyMetrics,
      }),
    );

    // DynamoDB Metrics Section
    this.dashboard.addWidgets(
      new TextWidget({
        markdown: '## DynamoDB',
        width: 24,
        height: 1,
      }),
    );

    // DynamoDB Read/Write Capacity
    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'DynamoDB Consumed Capacity Units',
        width: 12,
        height: 6,
        left: [
          new Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'ConsumedReadCapacityUnits',
            dimensionsMap: { TableName: dynamoTable.tableName },
            statistic: 'Sum',
            period: Duration.minutes(5),
            label: 'Read Capacity Units',
          }),
          new Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'ConsumedWriteCapacityUnits',
            dimensionsMap: { TableName: dynamoTable.tableName },
            statistic: 'Sum',
            period: Duration.minutes(5),
            label: 'Write Capacity Units',
          }),
        ],
      }),
    );

    // DynamoDB Throttled Requests
    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'DynamoDB Throttled Requests',
        width: 12,
        height: 6,
        left: [
          new Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'ThrottledRequests',
            dimensionsMap: { TableName: dynamoTable.tableName },
            statistic: 'Sum',
            period: Duration.minutes(5),
            label: 'Throttled Requests',
          }),
        ],
      }),
    );

    // DynamoDB Latency
    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'DynamoDB Latency (ms)',
        width: 12,
        height: 6,
        left: [
          new Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SuccessfulRequestLatency',
            dimensionsMap: { TableName: dynamoTable.tableName, Operation: 'GetItem' },
            statistic: 'Average',
            period: Duration.minutes(5),
            label: 'GetItem Latency',
          }),
          new Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SuccessfulRequestLatency',
            dimensionsMap: { TableName: dynamoTable.tableName, Operation: 'Query' },
            statistic: 'Average',
            period: Duration.minutes(5),
            label: 'Query Latency',
          }),
          new Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SuccessfulRequestLatency',
            dimensionsMap: { TableName: dynamoTable.tableName, Operation: 'PutItem' },
            statistic: 'Average',
            period: Duration.minutes(5),
            label: 'PutItem Latency',
          }),
        ],
      }),
    );

    // DynamoDB System Errors
    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'DynamoDB Errors',
        width: 12,
        height: 6,
        left: [
          new Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'SystemErrors',
            dimensionsMap: { TableName: dynamoTable.tableName },
            statistic: 'Sum',
            period: Duration.minutes(5),
            label: 'System Errors',
          }),
          new Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'UserErrors',
            dimensionsMap: { TableName: dynamoTable.tableName },
            statistic: 'Sum',
            period: Duration.minutes(5),
            label: 'User Errors',
          }),
        ],
      }),
    );
  }
}
