'use strict'

const Opal = global.Opal
const { $Antora } = require('../constants')
const $pageRefCallback = Symbol('pageRefCallback')

const Html5Converter = (() => {
  const scope = Opal.klass(
    Opal.module(null, 'Antora', $Antora),
    Opal.module(null, 'Asciidoctor').Converter.Html5Converter,
    'Html5Converter',
    function () {}
  )
  Opal.defn(scope, '$initialize', function initialize (backend, opts, callbacks) {
    Opal.send(this, Opal.find_super_dispatcher(this, 'initialize', initialize), [backend, opts])
    this[$pageRefCallback] = callbacks.onPageRef
  })
  Opal.defn(scope, '$inline_anchor', function convertInlineAnchor (node) {
    if (node.getType() === 'xref') {
      let callback
      if (node.getAttribute('path') && (callback = this[$pageRefCallback])) {
        const attrs = node.getAttributes()
        if (attrs.fragment === Opal.nil) delete attrs.fragment
        const { content, target, internal, unresolved } = callback(attrs.refid, node.getText())
        let options
        if (internal) {
          // QUESTION should we propogate the role in this case?
          options = Opal.hash2(['type', 'target'], { type: 'link', target })
        } else {
          attrs.role = `page${unresolved ? ' unresolved' : ''}${attrs.role ? ' ' + attrs.role : ''}`
          options = Opal.hash2(['type', 'target', 'attrs'], {
            type: 'link',
            target,
            attributes: Opal.hash2(Object.keys(attrs), attrs),
          })
        }
        node = Opal.module(null, 'Asciidoctor').Inline.$new(node.getParent(), 'anchor', content, options)
      }
    }
    return Opal.send(this, Opal.find_super_dispatcher(this, 'inline_anchor', convertInlineAnchor), [node])
  })
  return scope
})()

module.exports = Html5Converter
