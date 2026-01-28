import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MainStack } from '../lib/main-stack';

// FORGE: Simplified test - single stack in us-east-2, no custom domain
test('Snapshot test', () => {
  jest.useFakeTimers().setSystemTime(new Date('2020-01-01'));

  const app = new cdk.App();
  const props = {
    account: '123456789012',
  };

  // FORGE: Cost-optimized deployment to us-east-2 only
  const mainStack = new MainStack(app, 'TaskTitanForgeStack', {
    env: {
      account: props.account,
      region: 'us-east-2',
    },
  });

  const mainTemplate = Template.fromStack(mainStack);
  expect(mainTemplate).toMatchSnapshot();
});
