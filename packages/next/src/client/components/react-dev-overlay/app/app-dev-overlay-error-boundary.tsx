import { PureComponent, useEffect } from 'react'
import { RuntimeErrorHandler } from '../../errors/runtime-error-handler'
import { ErrorBoundary } from '../../error-boundary'
import DefaultGlobalError, {
  type GlobalErrorComponent,
} from '../../global-error'
// @ts-expect-error -- TODO: Dedicated entrypoint instead of resource query
import { dispatcher } from './app-dev-overlay?next-devtools-app-bridge' with { 'turbopack-transition': 'nextjs-devtools-app-frontend' }
import { handleClientError } from '../../errors/use-error-handler'
import { MISSING_ROOT_TAGS_ERROR } from '../../../../shared/lib/errors/constants'
import { isNextRouterError } from '../../is-next-router-error'

type AppDevOverlayErrorBoundaryProps = {
  children: React.ReactNode
  globalError: [GlobalErrorComponent, React.ReactNode]
}

type AppDevOverlayErrorBoundaryState = {
  reactError: unknown
}

function ErroredHtml({
  globalError: [GlobalError, globalErrorStyles],
  error,
}: {
  globalError: [GlobalErrorComponent, React.ReactNode]
  error: unknown
}) {
  if (!error) {
    return (
      <html>
        <head />
        <body />
      </html>
    )
  }
  return (
    <ErrorBoundary errorComponent={DefaultGlobalError}>
      {globalErrorStyles}
      <GlobalError error={error} />
    </ErrorBoundary>
  )
}

function readSsrError(): (Error & { digest?: string }) | null {
  if (typeof document === 'undefined') {
    return null
  }

  const ssrErrorTemplateTag = document.querySelector(
    'template[data-next-error-message]'
  )
  if (ssrErrorTemplateTag) {
    const message: string = ssrErrorTemplateTag.getAttribute(
      'data-next-error-message'
    )!
    const stack = ssrErrorTemplateTag.getAttribute('data-next-error-stack')
    const digest = ssrErrorTemplateTag.getAttribute('data-next-error-digest')
    const error = new Error(message)
    if (digest) {
      ;(error as any).digest = digest
    }
    // Skip Next.js SSR'd internal errors that which will be handled by the error boundaries.
    if (isNextRouterError(error)) {
      return null
    }
    error.stack = stack || ''
    return error
  }

  return null
}

// Needs to be in the same error boundary as the shell.
// If it commits, we know we recovered from an SSR error.
// If it doesn't commit, we errored again and React will take care of error reporting.
function ReplaySsrOnlyErrors({
  onBlockingError,
}: {
  onBlockingError: () => void
}) {
  if (process.env.NODE_ENV !== 'production') {
    // Need to read during render. The attributes will be gone after commit.
    const ssrError = readSsrError()
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      if (ssrError !== null) {
        // TODO(veil): Include original Owner Stack (NDX-905)
        // TODO(veil): Mark as recoverable error
        // TODO(veil): console.error
        handleClientError(ssrError)

        // If it's missing root tags, we can't recover, make it blocking.
        if (ssrError.digest === MISSING_ROOT_TAGS_ERROR) {
          onBlockingError()
        }
      }
    }, [ssrError, onBlockingError])
  }

  return null
}

export class AppDevOverlayErrorBoundary extends PureComponent<
  AppDevOverlayErrorBoundaryProps,
  AppDevOverlayErrorBoundaryState
> {
  state = { reactError: null }

  static getDerivedStateFromError(error: Error) {
    RuntimeErrorHandler.hadRuntimeError = true

    return {
      reactError: error,
    }
  }

  componentDidCatch() {
    dispatcher.openErrorOverlay()
  }

  render() {
    const { children, globalError } = this.props
    const { reactError } = this.state

    const fallback = (
      <ErroredHtml globalError={globalError} error={reactError} />
    )

    return reactError !== null ? (
      fallback
    ) : (
      <>
        <ReplaySsrOnlyErrors onBlockingError={dispatcher.openErrorOverlay} />
        {children}
      </>
    )
  }
}
