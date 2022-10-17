import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Schedule } from 'aws-cdk-lib/aws-events';

import { AwsLogsComptroller } from '../src';

test('State Machines Created', () => {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  new AwsLogsComptroller(stack, 'MyTestConstruct');
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::StepFunctions::StateMachine', 2);

  expect(template).toMatchSnapshot();
});

test('Scheduler enabled', () => {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  new AwsLogsComptroller(stack, 'MyTestConstruct', {
    schedule: true,
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::Events::Rule', 1);
  template.resourceCountIs('AWS::StepFunctions::StateMachine', 2);

  expect(template).toMatchSnapshot();
});

test('Custom schedule', () => {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  new AwsLogsComptroller(stack, 'MyTestConstruct', {
    schedule: Schedule.cron({
      day: '1', hour: '4', minute: '0',
    }),
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::Events::Rule', 1);
  template.resourceCountIs('AWS::StepFunctions::StateMachine', 2);

  expect(template).toMatchSnapshot();
});
