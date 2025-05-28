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

import { useInsertionEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { FontStyles } from '../font/font-styles'
import type { DebugInfo } from '../types'
import { DevOverlay } from '../ui/dev-overlay'

import type { DevIndicatorServerState } from '../../../../server/dev/dev-indicator-server-state'
import type { VersionInfo } from '../../../../server/dev/parse-version-info'

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

export function AppDevOverlay({
  getComponentStack,
  getOwnerStack,
}: {
  getComponentStack: (error: Error) => string | undefined
  getOwnerStack: (error: Error) => string | null | undefined
}) {
  const [state, dispatch] = useErrorOverlayReducer(
    'app',
    getComponentStack,
    getOwnerStack
  )

  useInsertionEffect(() => {
    maybeDispatch = dispatch

    // Can't schedule updates from useInsertionEffect, so we need to defer.
    // Could move this into a passive Effect but we don't want replaying when
    // we reconnect.
    const replayTimeout = setTimeout(() => {
      replayQueuedEvents(dispatch)
    })

    return () => {
      maybeDispatch = null
      clearTimeout(replayTimeout)
    }
  }, [])

  return (
    <>
      {/* Fonts can only be loaded outside the Shadow DOM. */}
      <FontStyles />
      <DevOverlay state={state} dispatch={dispatch} />
    </>
  )
}

let isMounted = false
export function renderAppDevOverlay(
  getComponentStack: (error: Error) => string | undefined,
  getOwnerStack: (error: Error) => string | null | undefined
): void {
  if (!isMounted) {
    // TODO: nextjs-portal
    const container = document.createElement('div')
    document.body.appendChild(container)

    const root = createRoot(container)

    // TODO: Dedicate error boundary or root error callbacks?
    // At least it won't unmount any user code if it errors.
    root.render(
      <AppDevOverlay
        getComponentStack={getComponentStack}
        getOwnerStack={getOwnerStack}
      />
    )

    isMounted = true
  }
}
