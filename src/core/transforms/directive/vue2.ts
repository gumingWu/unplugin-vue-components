import type {
  BlockStatement, CallExpression, File, FunctionExpression, Node, ObjectProperty, VariableDeclaration,
} from '@babel/types'
import type MagicString from 'magic-string'
import type { ParseResult } from '@babel/parser'
import { importModule, isPackageExists } from 'local-pkg'
import type { ResolveResult } from '../../transformer'

/**
 * get Vue 2 render function position
 * @param ast
 * @returns
 */
const getRenderFnStart = (ast: ParseResult<File>): number => {
  const renderFn = ast.program.body.find((node): node is VariableDeclaration =>
    node.type === 'VariableDeclaration'
      && node.declarations[0].id.type === 'Identifier'
      && ['render', '_sfc_render'].includes(node.declarations[0].id.name),
  )
  const start = (((renderFn?.declarations[0].init as FunctionExpression)?.body) as BlockStatement)?.start
  if (start === null || start === undefined)
    throw new Error('[unplugin-vue-components:directive] Cannot find render function position.')
  return start + 1
}

export default async function resolveVue2(code: string, s: MagicString): Promise<ResolveResult[]> {
  if (!isPackageExists('@babel/parser'))
    throw new Error('[unplugin-vue-components:directive] To use Vue 2 directive you will need to install Babel first: "npm install -D @babel/parser"')

  const { parse } = await importModule<typeof import('@babel/parser')>('@babel/parser')
  const ast = parse(code, {
    sourceType: 'module',
  })

  const nodes: CallExpression[] = []
  const { walk } = await import('estree-walker')
  walk(ast.program as any, {
    enter(node: any) {
      if ((node as Node).type === 'CallExpression')
        nodes.push(node)
    },
  })

  if (nodes.length === 0)
    return []

  const results: ResolveResult[] = []
  const renderStart = getRenderFnStart(ast)
  for (const node of nodes) {
    const { callee, arguments: args } = node
    // _c(_, {})
    if (callee.type !== 'Identifier' || callee.name !== '_c' || args[1]?.type !== 'ObjectExpression')
      continue

    // { directives: [] }
    const directives = args[1].properties.find(
      (property): property is ObjectProperty =>
        property.type === 'ObjectProperty'
          && property.key.type === 'Identifier'
          && property.key.name === 'directives',
    )?.value
    if (!directives || directives.type !== 'ArrayExpression')
      continue

    for (const directive of directives.elements) {
      if (directive?.type !== 'ObjectExpression')
        continue

      const nameNode = directive.properties.find(
        (p): p is ObjectProperty =>
          p.type === 'ObjectProperty'
            && p.key.type === 'Identifier'
            && p.key.name === 'name',
      )?.value
      if (nameNode?.type !== 'StringLiteral')
        continue
      const name = nameNode.value
      if (!name || name.startsWith('_'))
        continue
      results.push({
        rawName: name,
        replace: (resolved) => {
          s.prependLeft(renderStart!, `\nthis.$options.directives["${name}"] = ${resolved};`)
        },
      })
    }
  }

  return results
}
