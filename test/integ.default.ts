import { ExpectedResult, IntegTest, Match } from '@aws-cdk/integ-tests-alpha';
import { App, ArnFormat, Stack, StackProps } from 'aws-cdk-lib';
import { RequireApproval } from 'aws-cdk-lib/cloud-assembly-schema';
import { Construct } from 'constructs';

import { AwsLogsComptroller } from '../src';

class StackUnderTest extends Stack {
  constructor (scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new AwsLogsComptroller(this, 'LogsComptroller', {
    });
  }
}

const app = new App();
const stack = new StackUnderTest(app, 'StackUnderTest');

const integ = new IntegTest(app, 'Integ', {
  cdkCommandOptions: {
    deploy: {
      args: {
        json: true, requireApproval: RequireApproval.NEVER,
      },
    },
    destroy: {
      args: {
        force: true,
      },
    },
  },
  diffAssets: true,
  stackUpdateWorkflow: false,
  testCases: [stack],
});

const start = integ.assertions.awsApiCall('StepFunctions', 'startExecution', {
  stateMachineArn: Stack.of(stack).formatArn({
    arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    resource: 'stateMachine',
    resourceName: 'logs-comptroller-iterator',
    service: 'states',
  }),
});

integ.assertions.awsApiCall('StepFunctions', 'describeExecution', {
  executionArn: start.getAttString('executionArn'),
}).expect(ExpectedResult.objectLike({
  output: Match.stringLikeRegexp('LGsDeleted'),
  status: 'SUCCEEDED',
})).waitForAssertions();
