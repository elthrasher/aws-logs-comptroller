import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Choice, Condition, Errors, JsonPath, Map, Pass, Result, StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { CallAwsService } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export const getRunner = (
  scope: Construct,
  retentionInDays: RetentionDays = RetentionDays.ONE_WEEK,
): StateMachine => {
  /**
   * Input includes `LogGroups`, `Stats`, and `Token`.
   * Fan out on `LogGroups` (should be a max of 50).
   */
  const map = new Map(scope, 'Map', {
    inputPath: '$.LogGroups',
    maxConcurrency: 10,
    resultPath: '$.MapResult',
  });

  /**
   * Split LogGroupName into parts. We're looking for `lambda` in the second place.
   */
  const getLGParts = new Pass(scope, 'GetLGParts', {
    parameters: {
      'LGParts.$': 'States.StringSplit($.LogGroupName, \'/\')',
    },
    resultPath: JsonPath.stringAt('$.Function'),
  });

  /**
   * If we don't have at least two segments, `getLogType` will fail. Get the length here.
   * Can't seem to nest another intrinsic in `States.ArrayLength`.
   */
  const getArrayLen = new Pass(scope, 'GetArrayLen', {
    parameters: {
      Len: JsonPath.numberAt('States.ArrayLength($.Function.LGParts)'),
    },
    resultPath: '$.Array',
  });

  const twoOrMoreParts = new Choice(scope, 'TwoOrMore?');

  /**
   * Get the second part. We're looking for `lambda` to see if this is a LogGroup for a Lambda Function.
   */
  const getLogType = new Pass(scope, 'GetLogType', {
    parameters: {
      LogType: JsonPath.numberAt('States.ArrayGetItem($.Function.LGParts, 1)'),
    },
    resultPath: '$.Log',
  });

  const isLambdaLog = new Choice(scope, 'IsLambdaLog?');

  /**
   * The third part of the LogGroup name should be the name of the Lambda Function.
   */
  const getFnName = new Pass(scope, 'GetFnName', {
    parameters: {
      FunctionName: JsonPath.stringAt(
        'States.ArrayGetItem($.Function.LGParts, 2)',
      ),
    },
    resultPath: '$.Function',
  });

  const isFnPresent = new Choice(scope, 'FunctionPresent?');

  /**
   * Make API call to get the Lambda Function.
   * If this call is successful, then we have a LogGroup for an active Lambda Function.
   * If we get a 404 back, then the Lambda Function no longer exists and the LogGroup isn't needed.
   */
  const getFn = new CallAwsService(scope, 'GetFunction', {
    action: 'getFunction',
    iamResources: ['*'],
    parameters: {
      'FunctionName.$': '$.Function.FunctionName',
    },
    resultPath: JsonPath.DISCARD,
    service: 'lambda',
  });

  /**
   * Make an API call to delete a LogGroup.
   * This will end a branch of the Map State.
   * The resultSelector indicates the LogGroup was deleted.
   */
  const deleteLG = new CallAwsService(scope, 'DeleteLG', {
    action: 'deleteLogGroup',
    iamAction: 'logs:DeleteLogGroup',
    iamResources: ['*'],
    parameters: {
      LogGroupName: JsonPath.stringAt('$.LogGroupName'),
    },
    resultSelector: {
      IsDeleted: 1, IsRetained: 0,
    },
    service: 'cloudwatchlogs',
  });

  /**
   * Make an API call to set retention on the LogGroup.
   * This will end a branch of the Map State.
   * The resultSelector indicates retention was added.
   */
  const addRetention = new CallAwsService(scope, 'AddRetention', {
    action: 'putRetentionPolicy',
    iamAction: 'logs:PutRetentionPolicy',
    iamResources: ['*'],
    parameters: {
      LogGroupName: JsonPath.stringAt('$.LogGroupName'),
      RetentionInDays: retentionInDays,
    },
    resultSelector: {
      IsDeleted: 0, IsRetained: 1,
    },
    service: 'cloudwatchlogs',
  });

  /**
   * For any log group that survived the pruning above, check to see if it already has retention.
   * If it doesn't have retention, then set it to the `retentionInDays` prop.
   */
  const hasRetention = new Choice(scope, 'HasRetention?')
    .when(Condition.isNotPresent('$.RetentionInDays'), addRetention)
    .otherwise(
      new Pass(scope, 'lgtm', {
        result: Result.fromObject({
          IsDeleted: 0, IsRetained: 0,
        }),
      }),
    );

  /**
   * Initialize the loop for adding up the stats.
   */
  const initStatsLoop = new Pass(scope, 'InitStatsLoop', {
    parameters: {
      Index: 0,
      ResultLen: JsonPath.numberAt('States.ArrayLength($.MapResult)'),
    },
    resultPath: '$.Iterator',
  });

  /**
   * Get the next item of the array by index.
   */
  const getNextResult = new Pass(scope, 'GetNextResult', {
    parameters: {
      'Result.$': 'States.ArrayGetItem($.MapResult, $.Iterator.Index)',
    },
    resultPath: '$.R',
  });

  /**
   * Increment stats based on the `IsDeleted` and `IsRetained` values of the map result.
   */
  const incrementStats = new Pass(scope, 'IncrementStats', {
    parameters: {
      'LGsDeleted.$':
        'States.MathAdd($.Stats.LGsDeleted, $.R.Result.IsDeleted)',
      'LGsRetained.$':
        'States.MathAdd($.Stats.LGsRetained, $.R.Result.IsRetained)',
      LGsSeen: JsonPath.numberAt('$.Stats.LGsSeen'),
    },
    resultPath: '$.Stats',
  });

  /**
   * Increment the counter for the next loop.
   */
  const incrementCounter = new Pass(scope, 'IncrementCounter', {
    parameters: {
      'Index.$': 'States.MathAdd($.Iterator.Index, 1)',
      ResultLen: JsonPath.numberAt('$.Iterator.ResultLen'),
    },
    resultPath: '$.Iterator',
  });

  /**
   * Return the Task Token to the parent state machine and pass stats back.
   */
  const sendSuccess = new CallAwsService(scope, 'SendSuccess', {
    action: 'sendTaskSuccess',
    iamAction: 'states:SendTaskSuccess',
    iamResources: ['*'],
    parameters: {
      'Output.$': '$.Stats',
      'TaskToken.$': '$.Token',
    },
    service: 'sfn',
  });

  const hasNextMapResult = new Choice(scope, 'HasNextMapResult?');

  /**
   * Iterate over LogGroups, parsing the name to determine if it's a Lambda Log or not.
   */
  map.iterator(getLGParts);
  getLGParts.next(getArrayLen);
  getArrayLen.next(twoOrMoreParts);
  twoOrMoreParts.when(
    Condition.numberGreaterThanEquals('$.Array.Len', 2),
    getLogType,
  );
  twoOrMoreParts.otherwise(hasRetention);
  getLogType.next(isLambdaLog);

  /**
   * For each Lambda log, get the function name as the 3rd part of the LogGroup name.
   * Call the Lambda service to see if that function still exists.
   * If the function doesn't exist, then delete the log.
   */
  isLambdaLog.when(
    Condition.stringEquals('$.Log.LogType', 'lambda'),
    getFnName,
  );
  isLambdaLog.otherwise(hasRetention);
  getFnName.next(isFnPresent);
  isFnPresent.when(Condition.isNotNull('$.Function.FunctionName'), getFn);
  isFnPresent.otherwise(hasRetention);
  getFn.next(hasRetention);
  getFn.addCatch(deleteLG, {
    errors: [Errors.TASKS_FAILED],
    resultPath: JsonPath.DISCARD,
  });

  /**
   * After the map completes, loop over the results in order to track how many LogGroups were deleted
   * and how many had retention set.
   */
  map.next(initStatsLoop);
  initStatsLoop.next(hasNextMapResult);
  hasNextMapResult.when(
    Condition.numberLessThanJsonPath(
      '$.Iterator.Index',
      '$.Iterator.ResultLen',
    ),
    getNextResult,
  );
  getNextResult.next(incrementStats);

  incrementStats.next(incrementCounter);
  incrementCounter.next(hasNextMapResult);

  /**
   * Finally send the stats back to the parent state machine.
   */
  hasNextMapResult.otherwise(sendSuccess);

  /**
   * These calls may be throttled, so retry many times.
   * We probably don't need 10 retries, but the default wasn't enough.
   */
  addRetention.addRetry({
    maxAttempts: 10,
  });
  deleteLG.addRetry({
    maxAttempts: 10,
  });

  const sm = new StateMachine(scope, 'LogsComptrollerRunner', {
    definition: map,
    stateMachineName: 'logs-comptroller-runner',
    tracingEnabled: true,
  });

  /**
   * Workaround for CDK throwing a circular dependency error when attempting `grantTaskResponse`.
   */
  sm.addToRolePolicy(
    new PolicyStatement({
      actions: ['states:SendTaskSuccess'],
      resources: ['*'],
    }),
  );

  return sm;
};
