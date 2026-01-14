import { createServerRunner } from '@aws-amplify/adapter-nextjs';

type AmplifyServerRunner = ReturnType<typeof createServerRunner>;

let runnerPromise: Promise<AmplifyServerRunner> | null = null;

async function resolveAmplifyAppOrigin(): Promise<string> {
  if (process.env.AMPLIFY_APP_ORIGIN) {
    return process.env.AMPLIFY_APP_ORIGIN;
  }

  const sourceParam = process.env.AMPLIFY_APP_ORIGIN_SOURCE_PARAMETER;
  if (!sourceParam) {
    throw new Error('AMPLIFY_APP_ORIGIN not set. Required for OAuth callback URLs.');
  }

  // Only load AWS SDK + Powertools when we truly need the SSM fallback.
  const [{ GetParameterCommand, SSMClient }, { tracer }, { logger }] = await Promise.all([
    import('@aws-sdk/client-ssm'),
    import('@/lib/tracer'),
    import('@/lib/logger'),
  ]);

  const ssm = tracer.captureAWSv3Client(new SSMClient({}));
  const ssmStart = performance.now();

  try {
    const res = await ssm.send(new GetParameterCommand({ Name: sourceParam }));
    const value = res.Parameter?.Value;
    if (!value) {
      throw new Error(`SSM parameter ${sourceParam} has no value`);
    }

    process.env.AMPLIFY_APP_ORIGIN = value;

    const ssmDuration = performance.now() - ssmStart;
    logger.info('SSM parameter loaded', {
      parameter: sourceParam,
      duration_ms: Math.round(ssmDuration * 100) / 100,
    });

    return value;
  } catch (e) {
    const ssmDuration = performance.now() - ssmStart;
    logger.error('FATAL: Cannot load AMPLIFY_APP_ORIGIN from SSM', {
      parameter: sourceParam,
      duration_ms: Math.round(ssmDuration * 100) / 100,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

async function getRunner(): Promise<AmplifyServerRunner> {
  if (!runnerPromise) {
    runnerPromise = (async () => {
      const origin = await resolveAmplifyAppOrigin();

      return createServerRunner({
        config: {
          Auth: {
            Cognito: {
              userPoolId: process.env.USER_POOL_ID!,
              userPoolClientId: process.env.USER_POOL_CLIENT_ID!,
              loginWith: {
                oauth: {
                  redirectSignIn: [`${origin}/api/auth/sign-in-callback`],
                  redirectSignOut: [`${origin}/api/auth/sign-out-callback`],
                  responseType: 'code',
                  domain: process.env.COGNITO_DOMAIN!,
                  scopes: ['profile', 'openid', 'aws.cognito.signin.user.admin'],
                },
              },
            },
          },
        },
        runtimeOptions: {
          cookies: {
            sameSite: 'lax',
            // AWS Best Practice: Reduce maxAge to force more frequent token refresh
            // This minimizes cookie payload size sent to Lambda (6MB limit)
            // Trade-off: Users may need to re-authenticate more frequently
            maxAge: 60 * 60 * 2, // 2 hours (reduced from default 7 days)
          },
        },
      });
    })();
  }

  return runnerPromise;
}

type BaseRunWithArgs = Parameters<AmplifyServerRunner['runWithAmplifyServerContext']>[0];
type BaseRunWithOperation = BaseRunWithArgs['operation'];
type AmplifyContextSpec = Parameters<BaseRunWithOperation>[0];
type RunWithArgs<TResult> = Omit<BaseRunWithArgs, 'operation'> & {
  operation: (contextSpec: AmplifyContextSpec) => TResult | Promise<TResult>;
};

export async function runWithAmplifyServerContext<TResult>(args: RunWithArgs<TResult>): Promise<TResult> {
  const runner = await getRunner();
  return (runner.runWithAmplifyServerContext(args as unknown as BaseRunWithArgs) as unknown) as Promise<TResult>;
}

export async function createAuthRouteHandlers(
  ...args: Parameters<AmplifyServerRunner['createAuthRouteHandlers']>
): Promise<ReturnType<AmplifyServerRunner['createAuthRouteHandlers']>> {
  const runner = await getRunner();
  return runner.createAuthRouteHandlers(...args);
}
