import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTUtils, StyleBuilders, ASTBuilders } from '@teleporthq/teleport-plugin-common'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLStyleValue,
  PluginStyledJSX,
} from '@teleporthq/teleport-types'
import { generateStyledJSXTag } from './utils'
import * as types from '@babel/types'

interface StyledJSXConfig {
  componentChunkName: string
  forceScoping: boolean
}

export const createReactStyledJSXPlugin: ComponentPluginFactory<StyledJSXConfig> = (config) => {
  const { componentChunkName = 'jsx-component', forceScoping = false } = config || {}

  const reactStyledJSXPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, options } = structure
    const { projectStyleSet } = options
    const { node, styleSetDefinitions: componentStyleSheet = {}, propDefinitions = {} } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup as Record<string, types.JSXElement>
    const propsPrefix = componentChunk.meta.dynamicRefPrefix.prop as string
    const mediaStylesMap: Record<
      string,
      Array<{ [x: string]: Record<string, string | number> }>
    > = {}
    const classMap: string[] = []

    const transformStyle = (style: Record<string, UIDLStyleValue>) =>
      UIDLUtils.transformDynamicStyles(style, (styleValue) => {
        switch (styleValue.content.referenceType) {
          case 'token':
            return `var(${StringUtils.generateCSSVariableName(styleValue.content.id)})`
          case 'prop':
            return `\$\{${propsPrefix}.${styleValue.content.id}\}`
          default:
            throw new PluginStyledJSX(
              `Error running transformDynamicStyles in reactStyledJSXChunkPlugin.\n
              Unsupported styleValue.content.referenceType value ${styleValue.content.referenceType}`
            )
        }
      })

    UIDLUtils.traverseElements(node, (element) => {
      const classNamesToAppend: Set<string> = new Set()
      const dynamicVariantsToAppend: Set<types.Identifier | types.MemberExpression> = new Set()
      const {
        style = {},
        key,
        referencedStyles = {},
        attrs = {},
        dependency,
        elementType,
      } = element
      const elementClassName = StringUtils.camelCaseToDashCase(key)
      const className = getClassName(forceScoping, uidl.name, elementClassName)

      if (forceScoping && dependency?.type === 'local') {
        StyleBuilders.setPropValueForCompStyle({
          key,
          jsxNodesLookup,
          attrs,
          getClassName: (str: string) =>
            getClassName(forceScoping, StringUtils.camelCaseToDashCase(elementType), str),
        })
      }

      if (Object.keys(style).length === 0 && Object.keys(referencedStyles).length === 0) {
        return
      }

      const root = jsxNodesLookup[key]

      // Generating the string templates for the dynamic styles
      if (Object.keys(style).length > 0) {
        const styleRules = transformStyle(style)
        classMap.push(StyleBuilders.createCSSClass(className, styleRules))
        classNamesToAppend.add(className)
      }

      Object.values(referencedStyles).forEach((styleRef) => {
        switch (styleRef.content.mapType) {
          case 'inlined': {
            const condition = styleRef.content.conditions[0]
            if (condition.conditionType === 'screen-size') {
              const { maxWidth } = condition
              if (!mediaStylesMap[String(maxWidth)]) {
                mediaStylesMap[String(maxWidth)] = []
              }

              mediaStylesMap[String(maxWidth)].push({
                [className]: transformStyle(styleRef.content.styles),
              })
            }

            if (condition.conditionType === 'element-state') {
              classMap.push(
                StyleBuilders.createCSSClassWithSelector(
                  className,
                  `&:${condition.content}`,
                  transformStyle(styleRef.content.styles)
                )
              )
            }

            classNamesToAppend.add(className)
            return
          }

          case 'component-referenced': {
            if (styleRef.content.content.type === 'static') {
              classNamesToAppend.add(String(styleRef.content.content.content))
            }

            if (
              styleRef.content.content.type === 'dynamic' &&
              styleRef.content.content.content.referenceType === 'prop'
            ) {
              dynamicVariantsToAppend.add(
                types.memberExpression(
                  types.identifier(propsPrefix),
                  types.identifier(styleRef.content.content.content.id)
                )
              )
              const defaultPropValue =
                propDefinitions[styleRef.content.content.content.id]?.defaultValue
              if (!defaultPropValue) {
                return
              }

              propDefinitions[styleRef.content.content.content.id].defaultValue = getClassName(
                forceScoping,
                uidl.name,
                String(defaultPropValue)
              )
            }

            if (
              styleRef.content.content.type === 'dynamic' &&
              styleRef.content.content.content.referenceType === 'comp'
            ) {
              classNamesToAppend.add(
                getClassName(forceScoping, uidl.name, styleRef.content.content.content.id)
              )
            }

            return
          }

          case 'project-referenced': {
            const { content } = styleRef
            const referedStyle = projectStyleSet.styleSetDefinitions[content.referenceId]
            if (!referedStyle) {
              throw new PluginStyledJSX(`Project style - ${content.referenceId} is missing`)
            }

            classNamesToAppend.add(content.referenceId)
            return
          }

          default: {
            throw new PluginStyledJSX(
              `Un-supported style reference ${JSON.stringify(styleRef.content, null, 2)}`
            )
          }
        }
      })

      ASTUtils.addClassStringOnJSXTag(
        root as types.JSXElement,
        Array.from(classNamesToAppend).join(' '),
        'className',
        Array.from(dynamicVariantsToAppend)
      )
    })

    /* Generating component scoped styles */
    if (Object.keys(componentStyleSheet).length > 0) {
      StyleBuilders.generateStylesFromStyleSetDefinitions(
        componentStyleSheet,
        classMap,
        mediaStylesMap,
        (styleName: string) => getClassName(forceScoping, uidl.name, styleName)
      )
    }

    if (Object.keys(mediaStylesMap).length > 0) {
      classMap.push(...StyleBuilders.generateMediaStyle(mediaStylesMap))
    }

    if (classMap.length === 0) {
      return structure
    }

    const jsxASTNodeReference = generateStyledJSXTag(classMap.join('\n'))
    // We have the ability to insert the tag into the existig JSX structure, or do something else with it.
    // Here we take the JSX <style> tag and we insert it as the last child of the JSX structure
    // inside the React Component
    let rootJSXNode = jsxNodesLookup[uidl.node.content.key]

    const originalRootNode = rootJSXNode
    rootJSXNode = ASTBuilders.createJSXTag('')
    rootJSXNode.children.push(originalRootNode)

    // fetching the AST parent of the root JSXNode
    // We need to replace the root node with a fragment <>
    // The fragment will be the parent of both the old root JSXNode and the style tag
    const componentAST = componentChunk.content as types.VariableDeclaration
    const arrowFnExpr = componentAST.declarations[0].init as types.ArrowFunctionExpression
    const bodyStatement = arrowFnExpr.body as types.BlockStatement
    const returnStatement = bodyStatement.body[0] as types.ReturnStatement
    returnStatement.argument = rootJSXNode

    rootJSXNode.children.push(jsxASTNodeReference)
    return structure
  }

  return reactStyledJSXPlugin
}

export default createReactStyledJSXPlugin()

const getClassName = (scoping: boolean, uidlName: string, nodeStyleName: string) => {
  return scoping
    ? StringUtils.camelCaseToDashCase(`${uidlName}-${nodeStyleName}`)
    : StringUtils.camelCaseToDashCase(nodeStyleName)
}
