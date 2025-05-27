import {
  ACTION_BEFORE_REFRESH,
  ACTION_BUILD_ERROR,
  ACTION_BUILD_OK,
  ACTION_DEBUG_INFO,
  ACTION_DEV_INDICATOR,
  ACTION_REFRESH,
  ACTION_ERROR_OVERLAY_CLOSE,
  ACTION_ERROR_OVERLAY_OPEN,
  ACTION_ERROR_OVERLAY_TOGGLE,
  ACTION_STATIC_INDICATOR,
  ACTION_UNHANDLED_ERROR,
  ACTION_UNHANDLED_REJECTION,
  ACTION_VERSION_INFO,
  useErrorOverlayReducer,
} from '../shared'
import type { GlobalErrorComponent } from '../../global-error'

import { useEffect, useInsertionEffect } from 'react'
import { AppDevOverlayErrorBoundary as AppDevOverlayErrorBoundaryImpl } from './app-dev-overlay-error-boundary'
import { FontStyles } from '../font/font-styles'
import type { DebugInfo } from '../types'
import { DevOverlay } from '../ui/dev-overlay'
import { getComponentStack, getOwnerStack } from '../../errors/stitched-error'
import { handleClientError } from '../../errors/use-error-handler'
import { isNextRouterError } from '../../is-next-router-error'
import { MISSING_ROOT_TAGS_ERROR } from '../../../../shared/lib/errors/constants'
import type { DevIndicatorServerState } from '../../../../server/dev/dev-indicator-server-state'
import type { VersionInfo } from '../../../../server/dev/parse-version-info'

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

export function AppDevOverlayErrorBoundary({
  globalError,
  children,
}: {
  globalError: [GlobalErrorComponent, React.ReactNode]
  children: React.ReactNode
}) {
  function openOverlay() {
    dispatcher.openErrorOverlay()
  }

  return (
    <AppDevOverlayErrorBoundaryImpl
      globalError={globalError}
      onError={openOverlay}
    >
      <ReplaySsrOnlyErrors onBlockingError={openOverlay} />
      {children}
    </AppDevOverlayErrorBoundaryImpl>
  )
}

export interface Dispatcher {
  onBuildOk(): void
  onBuildError(message: string): void
  onVersionInfo(versionInfo: VersionInfo): void
  onDebugInfo(debugInfo: DebugInfo): void
  onBeforeRefresh(): void
  onRefresh(): void
  onStaticIndicator(status: boolean): void
  onDevIndicator(devIndicator: DevIndicatorServerState): void
  onUnhandledError(reason: Error): void
  onUnhandledRejection(reason: Error): void
  openErrorOverlay(): void
  closeErrorOverlay(): void
  toggleErrorOverlay(): void
}

type Dispatch = ReturnType<typeof useErrorOverlayReducer>[1]
let maybeDispatch: Dispatch | null = null
const queue: Array<(dispatch: Dispatch) => void> = []

// Events might be dispatched before we get a `dispatch` from React (e.g. console.error during module eval).
// We need to queue them until we have a `dispatch` function available.
function createQueuable<Args extends any[]>(
  queueableFunction: (dispatch: Dispatch, ...args: Args) => void
) {
  return (...args: Args) => {
    if (maybeDispatch) {
      queueableFunction(maybeDispatch, ...args)
    } else {
      queue.push((dispatch: Dispatch) => {
        queueableFunction(dispatch, ...args)
      })
    }
  }
}

// TODO: Extract into separate functions that are imported
export const dispatcher: Dispatcher = {
  onBuildOk: createQueuable((dispatch: Dispatch) => {
    dispatch({ type: ACTION_BUILD_OK })
  }),
  onBuildError: createQueuable((dispatch: Dispatch, message: string) => {
    dispatch({ type: ACTION_BUILD_ERROR, message })
  }),
  onBeforeRefresh: createQueuable((dispatch: Dispatch) => {
    dispatch({ type: ACTION_BEFORE_REFRESH })
  }),
  onRefresh: createQueuable((dispatch: Dispatch) => {
    dispatch({ type: ACTION_REFRESH })
  }),
  onVersionInfo: createQueuable(
    (dispatch: Dispatch, versionInfo: VersionInfo) => {
      dispatch({ type: ACTION_VERSION_INFO, versionInfo })
    }
  ),
  onStaticIndicator: createQueuable((dispatch: Dispatch, status: boolean) => {
    dispatch({ type: ACTION_STATIC_INDICATOR, staticIndicator: status })
  }),
  onDebugInfo: createQueuable((dispatch: Dispatch, debugInfo: DebugInfo) => {
    dispatch({ type: ACTION_DEBUG_INFO, debugInfo })
  }),
  onDevIndicator: createQueuable(
    (dispatch: Dispatch, devIndicator: DevIndicatorServerState) => {
      dispatch({ type: ACTION_DEV_INDICATOR, devIndicator })
    }
  ),
  onUnhandledError: createQueuable((dispatch: Dispatch, error: Error) => {
    dispatch({
      type: ACTION_UNHANDLED_ERROR,
      reason: error,
    })
  }),
  onUnhandledRejection: createQueuable((dispatch: Dispatch, error: Error) => {
    dispatch({
      type: ACTION_UNHANDLED_REJECTION,
      reason: error,
    })
  }),
  openErrorOverlay: createQueuable((dispatch: Dispatch) => {
    dispatch({ type: ACTION_ERROR_OVERLAY_OPEN })
  }),
  closeErrorOverlay: createQueuable((dispatch: Dispatch) => {
    dispatch({ type: ACTION_ERROR_OVERLAY_CLOSE })
  }),
  toggleErrorOverlay: createQueuable((dispatch: Dispatch) => {
    dispatch({ type: ACTION_ERROR_OVERLAY_TOGGLE })
  }),
}

function replayQueuedEvents(dispatch: NonNullable<typeof maybeDispatch>) {
  try {
    for (const queuedFunction of queue) {
      queuedFunction(dispatch)
    }
  } finally {
    // TODO: What to do with failed events?
    queue.length = 0
  }
}

export function AppDevOverlay() {
  const [state, dispatch] = useErrorOverlayReducer(
    'app',
    getComponentStack,
    getOwnerStack
  )

  useInsertionEffect(() => {
    maybeDispatch = dispatch

    replayQueuedEvents(dispatch)

    return () => {
      maybeDispatch = null
    }
  })

  return (
    <>
      {/* Fonts can only be loaded outside the Shadow DOM. */}
      <FontStyles />
      <DevOverlay state={state} dispatch={dispatch} />
    </>
  )
}
