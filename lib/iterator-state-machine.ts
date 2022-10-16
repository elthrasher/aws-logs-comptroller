import { Choice,
  Condition,
  IntegrationPattern,
  JsonPath,
  Pass,
  StateMachine,
  Succeed,
  TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { CallAwsService, StepFunctionsStartExecution } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export const getIteratorStateMachine = (
  scope: Construct,
  runner: StateMachine,
): StateMachine => {
  /**
   * Get first group of LogGroups.
   * Pagination is implicit, so we'll get the first 50 groups.
   * If there are more than 50 groups, we'll get a NextToken.
   */
  const getLogGroups = new CallAwsService(scope, 'GetLogGroups', {
    action: 'describeLogGroups',
    iamAction: 'logs:DescribeLogGroups',
    iamResources: ['*'],
    resultPath: '$.LG',
    service: 'cloudwatchlogs',
  });

  /**
   * Initialize stats object and set LGsSeen to the length of the returned array.
   * This will be our running total.
   */
  const setLGsSeen = new Pass(scope, 'SetLGsSeen', {
    parameters: {
      LGsDeleted: 0,
      LGsRetained: 0,
      LGsSeen: JsonPath.numberAt('States.ArrayLength($.LG.LogGroups)'),
    },
    resultPath: '$.Stats',
  });

  /**
   * Execute runner state machine to process the current batch of LogGroups.
   * Delegate this to a child state machine in order to avoid hitting the maximum event history of 25000 events.
   */
  const executeRunner = new StepFunctionsStartExecution(
    scope,
    'ExecuteRunner',
    {
      input: TaskInput.fromObject({
        LogGroups: JsonPath.objectAt('$.LG.LogGroups'),
        Stats: JsonPath.objectAt('$.Stats'),
        Token: JsonPath.taskToken,
      }),
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      resultPath: '$.Stats',
      stateMachine: runner,
    },
  );

  /**
   * Choice step determines whether we should start another loop or if the job is done.
   */
  const hasNextToken = new Choice(scope, 'HasNextToken?');

  /**
   * Get next batch of LogGroups with the NextToken.
   * Will return another NextToken if there are more results available.
   */
  const getNextLogGroups = new CallAwsService(scope, 'GetNextLogGroups', {
    action: 'describeLogGroups',
    iamAction: 'logs:DescribeLogGroups',
    iamResources: ['*'],
    parameters: {
      NextToken: JsonPath.stringAt('$.LG.NextToken'),
    },
    resultPath: '$.LG',
    service: 'cloudwatchlogs',
  });

  /**
   * Append running total of LogGroups after getting a subsequent batch.
   */
  const appendTotal = new Pass(scope, 'AppendTotal', {
    parameters: {
      LGsDeleted: JsonPath.numberAt('$.Stats.LGsDeleted'),
      LGsRetained: JsonPath.numberAt('$.Stats.LGsRetained'),
      'LGsSeen.$':
        'States.MathAdd($.Stats.LGsSeen, States.ArrayLength($.LG.LogGroups))',
    },
    resultPath: '$.Stats',
  });

  getLogGroups.next(
    setLGsSeen.next(
      executeRunner.next(
        hasNextToken
          .when(
            Condition.isPresent('$.LG.NextToken'),
            getNextLogGroups.next(appendTotal.next(executeRunner)),
          )
          .otherwise(
            new Succeed(scope, 'Work Complete!', {
              outputPath: '$.Stats',
            }),
          ),
      ),
    ),
  );

  return new StateMachine(scope, 'LogsComptrollerIterator', {
    definition: getLogGroups,
    stateMachineName: 'logs-comptroller-iterator',
    tracingEnabled: true,
  });
};
