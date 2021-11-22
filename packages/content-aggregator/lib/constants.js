'use strict'

const { compile: bracesToGroup } = require('braces')

module.exports = Object.freeze({
  COMPONENT_DESC_FILENAME: 'antora.yml',
  CONTENT_CACHE_FOLDER: 'content',
  CONTENT_SRC_GLOB: '**/*[!~]',
  CONTENT_SRC_OPTS: { follow: true, nomount: true, nosort: true, nounique: true, removeBOM: false, uniqueBy: (m) => m },
  FILE_MODES: { 100644: 0o100666 & ~process.umask(), 100755: 0o100777 & ~process.umask() },
  GIT_CORE: 'antora',
  GIT_OPERATION_LABEL_LENGTH: 8,
  GIT_PROGRESS_PHASES: ['Counting objects', 'Compressing objects', 'Receiving objects', 'Resolving deltas'],
  PICOMATCH_VERSION_OPTS: {
    bash: true,
    dot: true,
    fastpaths: false,
    expandRange: (begin, end, step, opts) => bracesToGroup(opts ? `{${begin}..${end}..${step}}` : `{${begin}..${end}}`),
    nobracket: true,
    noglobstar: true,
    nonegate: true,
    noquantifiers: true,
    regex: false,
    strictSlashes: true,
  },
  REF_PATTERN_CACHE_KEY: Symbol('RefPatternCache'),
  SYMLINK_FILE_MODE: '120000',
  VALID_STATE_FILENAME: 'valid',
})
