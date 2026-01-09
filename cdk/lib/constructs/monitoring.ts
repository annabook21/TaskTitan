import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { Dashboard, GraphWidget, Metric, TextWidget, Row } from 'aws-cdk-lib/aws-cloudwatch';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IDatabaseCluster } from 'aws-cdk-lib/aws-rds';

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
   * Database cluster to monitor
   */
  readonly databaseCluster: IDatabaseCluster;
}

/**
 * CloudWatch Monitoring Dashboard
 *
 * Creates a comprehensive monitoring dashboard for the TaskTitan application
 * including Lambda performance, database metrics, and error tracking.
 */
export class Monitoring extends Construct {
  public readonly dashboard: Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    const { applicationName, lambdaFunctions, databaseCluster } = props;

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

    // Database Metrics Section
    this.dashboard.addWidgets(
      new TextWidget({
        markdown: '## Aurora PostgreSQL Database',
        width: 24,
        height: 1,
      }),
    );

    // Database Connections
    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'Database Connections',
        width: 8,
        height: 6,
        left: [
          new Metric({
            namespace: 'AWS/RDS',
            metricName: 'DatabaseConnections',
            dimensionsMap: { DBClusterIdentifier: databaseCluster.clusterIdentifier },
            statistic: 'Average',
            period: Duration.minutes(5),
          }),
        ],
      }),
    );

    // Database CPU
    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'Database CPU Utilization (%)',
        width: 8,
        height: 6,
        left: [
          new Metric({
            namespace: 'AWS/RDS',
            metricName: 'CPUUtilization',
            dimensionsMap: { DBClusterIdentifier: databaseCluster.clusterIdentifier },
            statistic: 'Average',
            period: Duration.minutes(5),
          }),
        ],
      }),
    );

    // Database ACU (Serverless Capacity)
    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'Serverless Database Capacity (ACU)',
        width: 8,
        height: 6,
        left: [
          new Metric({
            namespace: 'AWS/RDS',
            metricName: 'ServerlessDatabaseCapacity',
            dimensionsMap: { DBClusterIdentifier: databaseCluster.clusterIdentifier },
            statistic: 'Average',
            period: Duration.minutes(5),
          }),
        ],
      }),
    );

    // Database Read/Write Latency
    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'Database Latency (ms)',
        width: 12,
        height: 6,
        left: [
          new Metric({
            namespace: 'AWS/RDS',
            metricName: 'ReadLatency',
            dimensionsMap: { DBClusterIdentifier: databaseCluster.clusterIdentifier },
            statistic: 'Average',
            period: Duration.minutes(5),
            label: 'Read Latency',
          }),
          new Metric({
            namespace: 'AWS/RDS',
            metricName: 'WriteLatency',
            dimensionsMap: { DBClusterIdentifier: databaseCluster.clusterIdentifier },
            statistic: 'Average',
            period: Duration.minutes(5),
            label: 'Write Latency',
          }),
        ],
      }),
    );

    // Database IOPS
    this.dashboard.addWidgets(
      new GraphWidget({
        title: 'Database IOPS',
        width: 12,
        height: 6,
        left: [
          new Metric({
            namespace: 'AWS/RDS',
            metricName: 'ReadIOPS',
            dimensionsMap: { DBClusterIdentifier: databaseCluster.clusterIdentifier },
            statistic: 'Average',
            period: Duration.minutes(5),
            label: 'Read IOPS',
          }),
          new Metric({
            namespace: 'AWS/RDS',
            metricName: 'WriteIOPS',
            dimensionsMap: { DBClusterIdentifier: databaseCluster.clusterIdentifier },
            statistic: 'Average',
            period: Duration.minutes(5),
            label: 'Write IOPS',
          }),
        ],
      }),
    );
  }
}
