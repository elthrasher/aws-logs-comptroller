# AWS Logs Comptroller

## :warning: This construct is designed to delete logs and log groups! **Use at your own risk!** :warning:

AWS Logs Comptroller is a CDK Construct that can be used to set CloudWatch log retention as well as prune orphaned LogGroups. AWS Logs Comptroller is written entirely using Step Functions and ASL. It makes [service integration calls](https://docs.aws.amazon.com/step-functions/latest/dg/supported-services-awssdk.html) and uses [intrinsic functions](https://docs.aws.amazon.com/step-functions/latest/dg/amazon-states-language-intrinsic-functions.html) in lieu of a custom compute layer such as a Lambda Function.

AWS Logs Comptroller can handle a large number of LogGroups without failure or timeout due to its architecture and has been tested with thousands of LogGroups. It makes many API calls to CloudWatch (to fetch, update and delete LogGroups) and to Lambda (to identify whether or not the LogGroup is attached to an existing Lambda Function) and may cause throttling to other processes that utilize these APIs.

```typescript
const app = new App();
const stack = new Stack(app);

new AwsLogsComptroller(this, stack);
```

## Log Retention

AWS Logs Comptroller will apply a [retention period](https://docs.aws.amazon.com/managedservices/latest/userguide/log-customize-retention.html) to any LogGroups that lack retention. The default for this is seven days but this can be overriden by passing in the `retentionDays` prop.

```typescript
const app = new App();
const stack = new Stack(app);

new AwsLogsComptroller(this, stack, { retentionDays: RetentionDays.ONE_DAY });
```

## Removing 'orphaned' Lambda LogGroups

Lambda automatically creates LogGroups when a function is called. If the function is later deleted, the LogGroup remains. AWS Logs Comptroller will remove any LogGroups that don't have existing Lambda Functions by parsing the name of the function from the LogGroup and attempting a `GetFunction` API call. If that call returns a 404, the LogGroup will be deleted.

## Scheduling

AWS Logs Comptroller can be scheduled using an EventBridge rule. By default, it'll use the default eventbus and run once daily.

```typescript
const app = new App();
const stack = new Stack(app);

new AwsLogsComptroller(this, stack, { schedule: true });
```

The `schedule` prop can also accept a cron expression.

```typescript
const app = new App();
const stack = new Stack(app);

new AwsLogsComptroller(this, stack, { schedule: Schedule.cron({ day: '1', hour: '4', minute: '0', }) });
```

Additionally the schedule Rule can be assigned to a custom EventBus.

```typescript
const app = new App();
const stack = new Stack(app);

const bus = new EventBus(stack, 'MyEventBus');
new AwsLogsComptroller(this, stack, { eventBus: bus, schedule: true });
```