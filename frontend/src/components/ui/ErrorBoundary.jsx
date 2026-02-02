import { Component } from 'react'
import { motion } from 'framer-motion'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ errorInfo })

    // Could send to error reporting service here
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mb-6"
          >
            <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </motion.div>

          <h2 className="text-xl font-display font-bold text-white mb-2">
            Something went wrong
          </h2>
          <p className="text-void-400 text-center max-w-md mb-6">
            An unexpected error occurred. This has been logged and we'll look into it.
          </p>

          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details className="mb-6 max-w-lg w-full">
              <summary className="cursor-pointer text-sm text-void-500 hover:text-void-300">
                Error details
              </summary>
              <pre className="mt-2 p-3 rounded-xl bg-void-800/50 text-xs text-red-400 overflow-auto">
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}

          <div className="flex space-x-3">
            <button
              onClick={this.handleReset}
              className="px-5 py-2.5 rounded-xl bg-void-700 hover:bg-void-600 font-medium transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-vibe-500/20 text-vibe-400 hover:bg-vibe-500/30 font-medium transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

// Inline error display for smaller components
export function InlineError({ message, onRetry }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-red-500/10 border border-red-500/30">
      <div className="flex items-center space-x-2">
        <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm text-red-400">{message}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs text-red-400 hover:text-red-300 underline"
        >
          Retry
        </button>
      )}
    </div>
  )
}

// Network error display
export function NetworkError({ onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
        </svg>
      </div>
      <h3 className="text-lg font-medium mb-2">Connection Error</h3>
      <p className="text-void-400 text-sm mb-4">
        Unable to connect to the network. Please check your connection.
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-xl bg-void-700 hover:bg-void-600 text-sm font-medium transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  )
}

// Contract not deployed error
export function ContractNotDeployed() {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-void-700 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-void-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      </div>
      <h3 className="text-lg font-medium mb-2">Contracts Not Deployed</h3>
      <p className="text-void-400 text-sm mb-2">
        VibeSwap contracts are not deployed on this network yet.
      </p>
      <p className="text-void-500 text-xs">
        Try switching to Sepolia testnet or local development.
      </p>
    </div>
  )
}

export default ErrorBoundary
