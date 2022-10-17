import { EventBus, Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { getIteratorStateMachine } from './iterator-state-machine';

import { getRunner } from './runner-state-machine';

export interface AwsLogsComptrollerProps {
  readonly eventBus?: EventBus
  readonly retentionDays?: RetentionDays
  readonly schedule?: boolean | Schedule
}

export class AwsLogsComptroller extends Construct {
  constructor (scope: Construct, id: string, props: AwsLogsComptrollerProps = {
  }) {
    super(scope, id);

    const { eventBus, retentionDays, schedule } = props;

    const runner = getRunner(scope, retentionDays);
    const iterator = getIteratorStateMachine(scope, runner);

    if (schedule) {
      new Rule(this, 'LogsComptrollerScheduler', {
        eventBus,
        schedule: schedule === true
          ? Schedule.cron({
            hour: '4', minute: '0',
          })
          : schedule,
        targets: [new SfnStateMachine(iterator)],
      });
    }
  }
}
