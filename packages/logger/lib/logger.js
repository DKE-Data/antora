'use strict'

const { posix: path } = require('path')
const {
  destination: buildDest,
  levels: { labels: levelLabels, values: levelValues },
  pino,
} = require('pino')

const closedLogger = { closed: true }
const minLevel = levelLabels[Math.min.apply(null, Object.keys(levelLabels))]
const noopLogger = pino({ base: null, enabled: false, timestamp: false }, {})
const rootLoggerHolder = new Map()

function close () {
  if (rootLoggerHolder.has()) Object.assign(rootLoggerHolder.get(), closedLogger)
}

function configure ({ level = 'info', failureLevel = 'silent', format = 'structured', destination } = {}) {
  if (level === 'silent' && failureLevel === 'silent' && (rootLoggerHolder.get() || {}).noop) return module.exports
  close()
  const prettyPrint = format === 'pretty'
  if (level === 'all') level = minLevel
  if (failureLevel === 'all') failureLevel = minLevel
  const logger = addFailOnExitHooks(
    level === 'silent'
      ? Object.assign(Object.create(Object.getPrototypeOf(noopLogger)), noopLogger)
      : pino(
        {
          name: 'antora',
          base: {},
          level,
          formatters: { level: (level) => ({ level }) },
          hooks: {
            // NOTE logMethod only called if log level is enabled
            logMethod (args, method) {
              const arg0 = args[0]
              if (arg0.constructor === Object) {
                const { file, line, stack, ...obj } = arg0
                // NOTE we assume file key is a file.src object
                args[0] = file ? Object.assign(obj, reshapeFileForLog(arg0)) : obj
              }
              method.apply(this, args)
            },
          },
          prettyPrint: prettyPrint && {
            customPrettifiers: {
              file: ({ path: path_, line }) => (line == null ? path_ : `${path_}:${line}`),
              stack: (stack, _, log) => {
                let prevSource = log.source
                return stack
                  .map(({ file: { path: path_, line }, source }) => {
                    const file = `${path_}:${line}`
                    const repeatSource =
                        prevSource &&
                        source.url === prevSource.url &&
                        source.refname === prevSource.refname &&
                        source.startPath === prevSource.startPath
                    prevSource = source
                    if (repeatSource) return `\n    file: ${file}`
                    const { url, worktree, refname, startPath } = source
                    source = worktree
                      ? `${worktree} (refname: ${refname} <worktree>${startPath ? ', start path: ' + startPath : ''})`
                      : `${url || '<unknown>'} (refname: ${refname}${startPath ? ', start path: ' + startPath : ''})`
                    return `\n    file: ${file}\n    source: ${source}`
                  })
                  .join('')
              },
              source: ({ url, worktree, refname, startPath }) =>
                worktree
                  ? `${worktree} (refname: ${refname} <worktree>${startPath ? ', start path: ' + startPath : ''})`
                  : `${url || '<unknown>'} (refname: ${refname}${startPath ? ', start path: ' + startPath : ''})`,
            },
            translateTime: 'SYS:HH:MM:ss.l', // Q: do we really need ms? should we honor DATE_FORMAT env var?
            ...(process.env.NODE_ENV === 'test' && { colorize: false }),
          },
        },
        destination || buildDest(prettyPrint ? 2 : 1)
      ),
    failureLevel
  )
  rootLoggerHolder.set(undefined, logger)
  return module.exports
}

function get (name) {
  if (name === null) return rootLoggerHolder.get()
  return new Proxy(noopLogger, {
    resolveTarget () {
      if ((this.ownRootLogger || closedLogger).closed) {
        if ((this.ownRootLogger = rootLoggerHolder.get() || closedLogger).closed) {
          ;(this.ownRootLogger = configure().get(null)).warn(
            'logger not configured; creating logger with default settings'
          )
        }
        this.target = undefined
      }
      return this.target || (this.target = name ? this.ownRootLogger.child({ name }) : this.ownRootLogger)
    },
    get (_, property) {
      return property === 'unwrap' ? () => this.resolveTarget() : this.resolveTarget()[property]
    },
    set (_, property, value) {
      this.resolveTarget()[property] = value
      return true
    },
  })
}

function finalize () {
  close()
  return Promise.resolve((rootLoggerHolder.get() || {}).failOnExit)
}

function reshapeFileForLog ({ file: { abspath, origin, path: vpath }, line, stack }) {
  if (origin) {
    const { url, refname, startPath, worktree } = origin
    const logObject = {
      file: { path: abspath || path.join(startPath, vpath), line },
      source: worktree
        ? { url, worktree, refname, startPath: startPath || undefined }
        : { url, refname, startPath: startPath || undefined },
    }
    if (stack) logObject.stack = stack.map(reshapeFileForLog)
    return logObject
  }
  return stack ? { file: { path: vpath, line }, stack: stack.map(reshapeFileForLog) } : { file: { path: vpath, line } }
}

function addFailOnExitHooks (logger, failureLevel = undefined) {
  let failureLevelVal
  if (failureLevel === undefined) {
    failureLevelVal = logger.failureLevelVal
  } else {
    logger.failureLevelVal = failureLevelVal = levelValues[failureLevel] || Infinity
    Object.defineProperty(logger, 'failureLevel', {
      enumerable: true,
      get () {
        return levelLabels[this.failureLevelVal]
      },
    })
    logger.setFailOnExit = setFailOnExit.bind(logger)
    logger.child = ((method) =>
      function (bindings) {
        return addFailOnExitHooks(method.call(this, bindings))
      })(logger.child)
  }
  Object.defineProperty(logger, 'noop', {
    enumerable: true,
    get () {
      return this.levelVal === Infinity && this.failureLevelVal === Infinity
    },
  })
  if (failureLevelVal === Infinity) return logger
  for (const [levelName, levelVal] of Object.entries(levelValues)) {
    if (levelVal >= failureLevelVal) logger[levelName] = decorateWithSetFailOnExit(logger[levelName])
  }
  return logger
}

function decorateWithSetFailOnExit (method) {
  return method.name === 'noop'
    ? callSetFailOnExit
    : function (...args) {
      this.setFailOnExit()
      method.apply(this, args)
    }
}

function callSetFailOnExit () {
  this.setFailOnExit()
}

function setFailOnExit () {
  this.failOnExit = true
}

module.exports = Object.assign(get, {
  close,
  closeLogger: close,
  configure,
  configureLogger: configure,
  finalize,
  finalizeLogger: finalize,
  get,
  getLogger: get,
})