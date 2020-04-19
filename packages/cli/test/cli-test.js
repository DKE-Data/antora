/* eslint-env mocha */
'use strict'

const { expect, heredoc, removeSyncForce } = require('../../../test/test-utils')

const fs = require('fs-extra')
const GitServer = require('node-git-server')
const { default: Kapok } = require('kapok-js')
const pkg = require('@antora/cli/package.json')
const ospath = require('path')
const RepositoryBuilder = require('../../../test/repository-builder')

const ANTORA_CLI = ospath.resolve('node_modules', '.bin', process.platform === 'win32' ? 'antora.cmd' : 'antora')
const CONTENT_REPOS_DIR = ospath.join(__dirname, 'content-repos')
const FIXTURES_DIR = ospath.join(__dirname, 'fixtures')
const UI_BUNDLE_URI =
  'https://gitlab.com/antora/antora-ui-default/-/jobs/artifacts/master/raw/build/ui-bundle.zip?job=bundle-stable'
const VERSION = pkg.version
const WORK_DIR = ospath.join(__dirname, 'work')
const ANTORA_CACHE_DIR = ospath.join(WORK_DIR, '.antora/cache')

Kapok.config.shouldShowLog = false

describe('cli', function () {
  let absDestDir
  let destDir
  let playbookSpec
  let playbookFile
  let repoBuilder
  let uiBundleUri
  let gitServer

  const timeoutOverride = this.timeout() * 2.5

  const createContentRepository = async (gitServerPort) =>
    (repoBuilder = new RepositoryBuilder(CONTENT_REPOS_DIR, FIXTURES_DIR, { remote: { gitServerPort } }))
      .init('the-component')
      .then((builder) => builder.checkoutBranch('v1.0'))
      .then((builder) =>
        builder.addComponentDescriptorToWorktree({
          name: 'the-component',
          version: '1.0',
          nav: ['modules/ROOT/nav.adoc'],
        })
      )
      .then((builder) => builder.importFilesFromFixture('the-component'))
      .then((builder) => builder.close('master'))

  // NOTE run the antora command from WORK_DIR by default to simulate a typical use case
  const runAntora = (args = undefined, env = undefined, cwd = WORK_DIR) => {
    if (!Array.isArray(args)) args = args ? args.split(' ') : []
    env = Object.assign({}, process.env, { ANTORA_CACHE_DIR }, env)
    return Kapok.start(ANTORA_CLI, args, { cwd, env })
  }

  before(async () => {
    fs.emptyDirSync(CONTENT_REPOS_DIR)
    gitServer = new GitServer(CONTENT_REPOS_DIR, { autoCreate: false })
    const gitServerPort = await new Promise((resolve, reject) =>
      gitServer.listen(0, function (err) {
        err ? reject(err) : resolve(this.address().port)
      })
    )
    await createContentRepository(gitServerPort)
    destDir = 'build/site'
    absDestDir = ospath.join(WORK_DIR, destDir)
    playbookFile = ospath.join(WORK_DIR, 'the-site.json')
    uiBundleUri = UI_BUNDLE_URI
  })

  beforeEach(() => {
    fs.ensureDirSync(WORK_DIR)
    try {
      fs.unlinkSync(playbookFile)
    } catch (ioe) {
      if (ioe.code !== 'ENOENT') throw ioe
    }
    // NOTE keep the default cache folder between tests
    removeSyncForce(ospath.join(WORK_DIR, destDir.split('/')[0]))
    removeSyncForce(ospath.join(WORK_DIR, '.antora-cache-override'))
    playbookSpec = {
      site: { title: 'The Site' },
      content: {
        sources: [{ url: repoBuilder.repoPath, branches: 'v1.0' }],
      },
      ui: { bundle: { url: uiBundleUri, snapshot: true } },
    }
  })

  after(async () => {
    await new Promise((resolve, reject) => gitServer.server.close((err) => (err ? reject(err) : resolve())))
    removeSyncForce(CONTENT_REPOS_DIR)
    if (process.env.KEEP_CACHE) {
      removeSyncForce(ospath.join(WORK_DIR, destDir.split('/')[0]))
      fs.unlinkSync(playbookFile)
    } else {
      removeSyncForce(WORK_DIR)
    }
  })

  it('should output version when called with "-v"', () => {
    return runAntora('-v')
      .assert(VERSION)
      .done()
  })

  it('should output version when invoked with "version"', () => {
    return runAntora('version')
      .assert(VERSION)
      .done()
  })

  it('should output usage when called with no command, options, or arguments', () => {
    return runAntora()
      .assert(/^Usage: antora/)
      .done()
  })

  it('should output usage when called with "-h"', () => {
    return runAntora('-h')
      .assert(/^Usage: antora/)
      .done()
  })

  it('should output list of common options when invoked with "-h"', () => {
    return runAntora('-h', { COLUMNS: 90 })
      .ignoreUntil(/^Options:/)
      .assert(/^ *-v, --version +Output the version number\./)
      .assert(/^ *-r, --require .*/)
      .assert(/^executing command\.$/)
      .assert(/^ *--stacktrace .*/)
      .assert(/^fails\.$/)
      .assert(/^ *-h, --help +Output usage information\./)
      .done()
  })

  it('should output list of commands when invoked with "-h"', () => {
    return runAntora('-h')
      .ignoreUntil(/^Commands:/)
      .assert(/^ *generate \[options\] <playbook>/)
      .done()
  })

  it('should output usage for generate command when invoked with "generate -h"', () => {
    return runAntora('generate -h')
      .assert(/^Usage: antora generate/)
      .done()
  })

  it('should output usage for generate command when invoked with "help generate"', () => {
    return runAntora('help generate')
      .assert(/^Usage: antora generate/)
      .done()
  })

  it('should output usage for main command when invoked with "help"', () => {
    return runAntora('help')
      .assert(/^Usage: antora/)
      .done()
  })

  it('should output warning that command does not exist when invoked with "help no-such-command"', () => {
    return runAntora('help no-such-command')
      .assert(/not a valid command/)
      .done()
  })

  it('should output options from playbook schema for generate command', () => {
    let options
    return (
      runAntora('generate -h')
        .ignoreUntil(/^Options:/)
        // -h option is always listed last
        .joinUntil(/^ *-h, --help/, { join: '\n' })
        .assert((optionsText) => {
          // NOTE unwrap lines
          options = optionsText.split('\n').reduce((accum, line) => {
            if (line.startsWith('-')) {
              accum.push(line)
            } else {
              accum.push(accum.pop() + ' ' + line)
            }
            return accum
          }, [])
          options = options.reduce((accum, line) => {
            const [sig, ...dsc] = line.split('  ')
            accum[sig.trim()] = dsc.join('').trim()
            return accum
          }, {})
          return true
        })
        .done()
        .then(() => {
          const optionForms = Object.keys(options)
          expect(optionForms).to.not.be.empty()
          expect(optionForms).to.include('--title <title>')
          expect(optionForms).to.include('--url <url>')
          expect(optionForms).to.include('--html-url-extension-style <option>')
          expect(options['--html-url-extension-style <option>']).to.have.string('(options: default, drop, or indexify)')
          expect(options['--html-url-extension-style <option>']).to.have.string('(default: default)')
          expect(optionForms).to.include('--generator <library>')
          expect(options['--generator <library>']).to.have.string('(default: @antora/site-generator-default)')
          // check options are sorted, except drop -h as we know it always comes last
          expect(optionForms.slice(0, -1)).to.eql(
            Object.keys(options)
              .slice(0, -1)
              .sort((a, b) => a.localeCompare(b))
          )
        })
    )
  })

  it('should show error message if generate command is run without an argument', () => {
    return runAntora('generate')
      .assert(/missing required argument 'playbook'/)
      .done()
  })

  it('should show error message if generate command is run with unknown argument', () => {
    return runAntora('generate does-not-exist.json --unknown')
      .assert(/unknown option '--unknown'/)
      .done()
  })

  it('should show error message if default command is run with unknown argument', () => {
    return runAntora('--unknown the-site')
      .assert(/unknown option '--unknown'/)
      .done()
  })

  it('should show error message if specified playbook file does not exist', () => {
    return runAntora('generate does-not-exist.json')
      .assert(/playbook .* does not exist/)
      .done()
  }).timeout(timeoutOverride)

  it('should show stack if --stacktrace option is specified and an exception is thrown during generation', () => {
    playbookSpec.ui.bundle.url = false
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    return runAntora('--stacktrace generate the-site')
      .assert(/^Error: ui\.bundle\.url: must be of type String/)
      .assert(/at /)
      .done()
  }).timeout(timeoutOverride)

  it('should recommend --stacktrace option if not specified and an exception is thrown during generation', () => {
    playbookSpec.ui.bundle.url = false
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    return runAntora('generate the-site')
      .assert(/^error: ui\.bundle\.url: must be of type String/)
      .assert(/--stacktrace option/)
      .done()
  }).timeout(timeoutOverride)

  it('should generate site to fs destination when playbook file is passed to generate command', () => {
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora('generate the-site --quiet').on('exit', resolve)).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(absDestDir)
        .to.be.a.directory()
        .with.subDirs(['_', 'the-component'])
      expect(ospath.join(absDestDir, 'the-component'))
        .to.be.a.directory()
        .with.subDirs(['1.0'])
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html')).to.be.a.file()
    })
  }).timeout(timeoutOverride)

  it('should generate site to fs destination when absolute playbook file is passed to generate command', () => {
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora(['generate', playbookFile, '--quiet']).on('exit', resolve)).then(
      (exitCode) => {
        expect(exitCode).to.equal(0)
        expect(absDestDir)
          .to.be.a.directory()
          .with.subDirs(['_', 'the-component'])
        expect(ospath.join(absDestDir, 'the-component'))
          .to.be.a.directory()
          .with.subDirs(['1.0'])
        expect(ospath.join(absDestDir, 'the-component/1.0/index.html')).to.be.a.file()
      }
    )
  }).timeout(timeoutOverride)

  it('should resolve dot-relative paths in playbook relative to playbook dir', () => {
    const runCwd = ospath.join(WORK_DIR, 'some-other-folder')
    fs.ensureDirSync(runCwd)
    const relPlaybookFile = ospath.relative(runCwd, playbookFile)
    playbookSpec.content.sources[0].url =
      '.' + ospath.sep + ospath.relative(WORK_DIR, playbookSpec.content.sources[0].url)
    playbookSpec.ui.bundle.url =
      '.' + ospath.sep + ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'ui-bundle.zip'))
    playbookSpec.output = { dir: '.' + ospath.sep + destDir }
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) =>
      runAntora(['generate', relPlaybookFile, '--quiet'], undefined, runCwd).on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(absDestDir)
        .to.be.a.directory()
        .with.subDirs(['_', 'the-component'])
      expect(ospath.join(absDestDir, 'the-component'))
        .to.be.a.directory()
        .with.subDirs(['1.0'])
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html')).to.be.a.file()
    })
  }).timeout(timeoutOverride)

  describe('cache directory', async () => {
    it('should store cache in cache directory passed to --cache-dir option', () => {
      playbookSpec.content.sources[0].url = repoBuilder.url
      fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
      const absCacheDir = ospath.resolve(WORK_DIR, '.antora-cache-override')
      expect(absCacheDir).to.not.be.a.path()
      // Q: how do we assert w/ kapok when there's no output; use promise as workaround
      return new Promise((resolve) =>
        runAntora(['generate', 'the-site', '--cache-dir', '.antora-cache-override']).on('exit', resolve)
      ).then((exitCode) => {
        expect(exitCode).to.equal(0)
        expect(absCacheDir)
          .to.be.a.directory()
          .with.subDirs(['content', 'ui'])
        expect(ospath.join(absCacheDir, 'content'))
          .to.be.a.directory()
          .and.not.be.empty()
        expect(ospath.join(absCacheDir, 'ui'))
          .to.be.a.directory()
          .and.not.be.empty()
        removeSyncForce(absCacheDir)
      })
    }).timeout(timeoutOverride)

    it('should store cache in cache directory defined by ANTORA_CACHE_DIR environment variable', () => {
      playbookSpec.content.sources[0].url = repoBuilder.url
      fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
      const absCacheDir = ospath.resolve(WORK_DIR, '.antora-cache-override')
      expect(absCacheDir).to.not.be.a.path()
      // Q: how do we assert w/ kapok when there's no output; use promise as workaround
      return new Promise((resolve) =>
        runAntora('generate the-site', { ANTORA_CACHE_DIR: '.antora-cache-override' }).on('exit', resolve)
      ).then((exitCode) => {
        expect(exitCode).to.equal(0)
        expect(absCacheDir)
          .to.be.a.directory()
          .with.subDirs(['content', 'ui'])
        expect(ospath.join(absCacheDir, 'content'))
          .to.be.a.directory()
          .and.not.be.empty()
        expect(ospath.join(absCacheDir, 'ui'))
          .to.be.a.directory()
          .and.not.be.empty()
        removeSyncForce(absCacheDir)
      })
    }).timeout(timeoutOverride)
  })

  it('should allow CLI option to override properties set in playbook file', () => {
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) =>
      runAntora(['generate', 'the-site', '--title', 'Awesome Docs', '--quiet']).on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
        .to.be.a.file()
        .with.contents.that.match(new RegExp('<title>Index Page :: Awesome Docs</title>'))
    })
  }).timeout(timeoutOverride)

  it('should allow environment variable to override properties set in playbook file', () => {
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    const env = Object.assign({ URL: 'https://docs.example.com' }, process.env)
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora('generate the-site --quiet', env).on('exit', resolve)).then(
      (exitCode) => {
        expect(exitCode).to.equal(0)
        expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
          .to.be.a.file()
          .with.contents.that.match(new RegExp('<link rel="canonical" href="https://docs.example.com/[^"]*">'))
      }
    )
  }).timeout(timeoutOverride)

  it('should pass keys defined using options to UI model', () => {
    playbookSpec.site.keys = { google_analytics: 'UA-12345-1' }
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // NOTE we're treating hyphens and underscores in the key name as equivalent
    const args = ['generate', 'the-site', '--key', 'foo=bar', '--key', 'google-analytics=UA-67890-1']
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora(args).on('exit', resolve)).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html'))
        .to.be.a.file()
        .with.contents.that.match(/src="https:\/\/www[.]googletagmanager[.]com\/gtag\/js\?id=UA-67890-1">/)
    })
  }).timeout(timeoutOverride)

  it('should remap legacy --google-analytics-key option', () => {
    playbookSpec.site.keys = { google_analytics: 'UA-12345-1' }
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    const args = ['generate', 'the-site', '--google-analytics-key', 'UA-67890-1']
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora(args).on('exit', resolve)).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html'))
        .to.be.a.file()
        .with.contents.that.match(/src="https:\/\/www[.]googletagmanager[.]com\/gtag\/js\?id=UA-67890-1">/)
    })
  }).timeout(timeoutOverride)

  it('should pass attributes defined using options to AsciiDoc processor', () => {
    playbookSpec.asciidoc = { attributes: { idprefix: '' } }
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    const args = ['generate', 'the-site', '--attribute', 'sectanchors=~', '--attribute', 'experimental', '--quiet']
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora(args).on('exit', resolve)).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html'))
        .to.be.a.file()
        .with.contents.that.match(/<h2 id="section_a">Section A<\/h2>/)
        .and.with.contents.that.match(/<kbd>Ctrl<\/kbd>\+<kbd>T<\/kbd>/)
    })
  }).timeout(timeoutOverride)

  it('should invoke generate command if no command is specified', () => {
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    // TODO once we have common options, we'll need to be sure they get moved before the default command
    return new Promise((resolve) =>
      runAntora('the-site.json --url https://docs.example.com --quiet').on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
        .to.be.a.file()
        .with.contents.that.match(new RegExp('<link rel="canonical" href="https://docs.example.com/[^"]*">'))
    })
  }).timeout(timeoutOverride)

  it('should allow CLI option name and value to be separated by an equals sign', () => {
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    // TODO once we have common options, we'll need to be sure they get moved before the default command
    return new Promise((resolve) =>
      runAntora('--title=#allthedocs --url=https://docs.example.com --quiet the-site.json').on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
        .to.be.a.file()
        .with.contents.that.match(new RegExp('<title>Index Page :: #allthedocs</title>'))
        .with.contents.that.match(new RegExp('<link rel="canonical" href="https://docs.example.com/[^"]*">'))
    })
  }).timeout(timeoutOverride)

  it('should use the generator specified by the --generator option', () => {
    const generator = ospath.resolve(FIXTURES_DIR, 'simple-generator')
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    return new Promise((resolve) =>
      runAntora(`generate the-site.json --generator ${generator}`).on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(ospath.join(absDestDir, '418.html'))
        .to.be.a.file()
        .with.contents.that.match(/I'm a teapot/)
    })
  })

  it('should show error message if custom generator fails to load', () => {
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // FIXME assert that exit code is 1 (limitation in Kapok when using assert)
    return runAntora('--generator no-such-module generate the-site')
      .assert(/error: Generator not found or failed to load. Try installing the 'no-such-module' package./i)
      .done()
  })

  it('should clean output directory before generating when --clean switch is used', () => {
    const residualFile = ospath.join(absDestDir, 'the-component/1.0/old-page.html')
    fs.ensureDirSync(ospath.dirname(residualFile))
    fs.writeFileSync(residualFile, '<!DOCTYPE html><html><body>contents</body></html>')
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) => runAntora('generate the-site.json --clean --quiet').on('exit', resolve)).then(
      (exitCode) => {
        expect(exitCode).to.equal(0)
        expect(ospath.join(absDestDir, 'the-component/1.0/index.html')).to.be.a.file()
        expect(residualFile).to.not.be.a.path()
      }
    )
  }).timeout(timeoutOverride)

  it('should output to directory specified by --to-dir option', () => {
    // NOTE we must use a subdirectory of destDir so it gets cleaned up properly
    const betaDestDir = ospath.join(destDir, 'beta')
    const absBetaDestDir = ospath.join(absDestDir, 'beta')
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) =>
      runAntora(['generate', 'the-site.json', '--to-dir', betaDestDir, '--quiet']).on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(absBetaDestDir).to.be.a.directory()
      expect(ospath.join(absBetaDestDir, 'the-component/1.0/index.html')).to.be.a.file()
    })
  }).timeout(timeoutOverride)

  it('should discover locally installed default site generator', () => {
    const runCwd = ospath.join(WORK_DIR, 'some-other-folder')
    fs.ensureDirSync(runCwd)
    const globalModulePath = require.resolve('@antora/site-generator-default')
    const localNodeModules = ospath.join(WORK_DIR, 'node_modules')
    const localModulePath = ospath.join(localNodeModules, '@antora/site-generator-default')
    fs.ensureDirSync(localModulePath)
    const localScript = heredoc`module.exports = async (args, env) => {
      console.log('Using custom site generator')
      return require(${JSON.stringify(globalModulePath)})(args.concat('--title', 'Custom Site Generator'), env)
    }`
    fs.writeFileSync(ospath.join(localModulePath, 'generate-site.js'), localScript)
    fs.writeJsonSync(ospath.join(localModulePath, 'package.json'), { main: 'generate-site.js' }, { spaces: 2 })
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    const relPlaybookFile = ospath.relative(runCwd, playbookFile)
    const messages = []
    return new Promise((resolve) =>
      runAntora(['generate', relPlaybookFile, '--quiet'], undefined, runCwd)
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      removeSyncForce(localNodeModules)
      expect(exitCode).to.equal(0)
      expect(messages).to.include('Using custom site generator')
      expect(absDestDir).to.be.a.directory()
      expect(ospath.join(absDestDir, 'the-component/1.0/index.html'))
        .to.be.a.file()
        .with.contents.that.match(new RegExp('<title>Index Page :: Custom Site Generator</title>'))
    })
  }).timeout(timeoutOverride)

  it('should show error message if require path fails to load', () => {
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // FIXME assert that exit code is 1 (limitation in Kapok when using assert)
    return runAntora('-r no-such-module generate the-site')
      .assert(/error: Cannot find module/i)
      .done()
  })

  it('should show error message if site generator fails to load', () => {
    const localNodeModules = ospath.join(WORK_DIR, 'node_modules')
    const localModulePath = ospath.join(localNodeModules, '@antora/site-generator-default')
    fs.ensureDirSync(localModulePath)
    fs.writeFileSync(ospath.join(localModulePath, 'index.js'), 'throw false')
    fs.writeJsonSync(ospath.join(localModulePath, 'package.json'), { main: 'index.js' }, { spaces: 2 })
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    // FIXME assert that exit code is 1 (limitation in Kapok when using assert)
    return runAntora('generate the-site')
      .assert(/not found or failed to load/i)
      .on('exit', () => removeSyncForce(localNodeModules))
      .done()
  })

  it('should preload libraries specified using the require option', () => {
    fs.writeJsonSync(playbookFile, playbookSpec, { spaces: 2 })
    const r1 = ospath.resolve(FIXTURES_DIR, 'warming-up')
    const r2 = ospath.relative(WORK_DIR, ospath.join(FIXTURES_DIR, 'global-postprocessor'))
    const args = ['--require', r1, '-r', r2, 'generate', 'the-site', '--quiet']
    const messages = []
    // Q: how do we assert w/ kapok when there's no output; use promise as workaround
    return new Promise((resolve) =>
      runAntora(args)
        .on('data', (data) => messages.push(data.message))
        .on('exit', resolve)
    ).then((exitCode) => {
      expect(exitCode).to.equal(0)
      expect(messages).to.include('warming up...')
      expect(ospath.join(absDestDir, 'the-component/1.0/the-page.html'))
        .to.be.a.file()
        .with.contents.that.match(/<p>Fin!<\/p>/)
    })
  }).timeout(timeoutOverride)
})
