import {
  PackProjectFunction,
  GenerateComponentFunction,
  ComponentUIDL,
  PublisherType,
  ProjectType,
  ComponentType,
  StyleVariation,
  ReactStyleVariation,
  InvalidProjectTypeError,
  InvalidPublisherTypeError,
  GeneratorOptions,
  Mapping,
  ComponentGenerator,
  ComponentGeneratorInstance,
  ProjectPlugin,
  HTMLComponentGenerator,
} from '@teleporthq/teleport-types'
import { Constants } from '@teleporthq/teleport-shared'

import { createProjectPacker } from '@teleporthq/teleport-project-packer'
import {
  ReactTemplate,
  createReactProjectGenerator,
  ReactProjectMapping,
} from '@teleporthq/teleport-project-generator-react'
import {
  createNextProjectGenerator,
  NextTemplate,
} from '@teleporthq/teleport-project-generator-next'
import {
  VueTemplate,
  createVueProjectGenerator,
  VueProjectMapping,
} from '@teleporthq/teleport-project-generator-vue'
import {
  NuxtTemplate,
  createNuxtProjectGenerator,
} from '@teleporthq/teleport-project-generator-nuxt'
import {
  PreactTemplate,
  PreactCodesandBoxTemplate,
  createPreactProjectGenerator,
  PreactProjectMapping,
} from '@teleporthq/teleport-project-generator-preact'
import {
  createStencilProjectGenerator,
  StencilTemplate,
  StencilProjectMapping,
} from '@teleporthq/teleport-project-generator-stencil'
import {
  createReactNativeProjectGenerator,
  ReactNativeTemplate,
  ReactNativeProjectMapping,
} from '@teleporthq/teleport-project-generator-reactnative'
import {
  createAngularProjectGenerator,
  AngularTemplate,
  AngularProjectMapping,
} from '@teleporthq/teleport-project-generator-angular'
import {
  createGridsomeProjectGenerator,
  GridsomeTemplate,
} from '@teleporthq/teleport-project-generator-gridsome'
import {
  createGatsbyProjectGenerator,
  GatsbyTemplate,
} from '@teleporthq/teleport-project-generator-gatsby'
import {
  createHTMLProjectGenerator,
  HTMLTemplate,
  pluginCloneGlobals,
  pluginImageResolver,
} from '@teleporthq/teleport-project-generator-html'

import { createZipPublisher } from '@teleporthq/teleport-publisher-zip'
import { createVercelPublisher } from '@teleporthq/teleport-publisher-vercel'
import { createNetlifyPublisher } from '@teleporthq/teleport-publisher-netlify'
import { createGithubPublisher } from '@teleporthq/teleport-publisher-github'
import { createCodesandboxPublisher } from '@teleporthq/teleport-publisher-codesandbox'

import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createPreactComponentGenerator } from '@teleporthq/teleport-component-generator-preact'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createStencilComponentGenerator } from '@teleporthq/teleport-component-generator-stencil'
import { createAngularComponentGenerator } from '@teleporthq/teleport-component-generator-angular'
import { createReactNativeComponentGenerator } from '@teleporthq/teleport-component-generator-reactnative'
import {
  createHTMLComponentGenerator,
  PlainHTMLMapping,
} from '@teleporthq/teleport-component-generator-html'
import { isNodeProcess } from './utils'

const componentGeneratorFactories: Record<ComponentType, ComponentGeneratorInstance> = {
  [ComponentType.REACT]: createReactComponentGenerator,
  [ComponentType.PREACT]: createPreactComponentGenerator,
  [ComponentType.ANGULAR]: createAngularComponentGenerator,
  [ComponentType.VUE]: createVueComponentGenerator,
  [ComponentType.STENCIL]: createStencilComponentGenerator,
  [ComponentType.REACTNATIVE]: createReactNativeComponentGenerator,
  [ComponentType.HTML]: createHTMLComponentGenerator,
}

const componentGeneratorProjectMappings = {
  [ComponentType.REACT]: ReactProjectMapping,
  [ComponentType.PREACT]: PreactProjectMapping,
  [ComponentType.ANGULAR]: AngularProjectMapping,
  [ComponentType.VUE]: VueProjectMapping,
  [ComponentType.STENCIL]: StencilProjectMapping,
  [ComponentType.REACTNATIVE]: ReactNativeProjectMapping,
  [ComponentType.HTML]: PlainHTMLMapping,
}

const projectGeneratorFactories = {
  [ProjectType.REACT]: createReactProjectGenerator(),
  [ProjectType.NEXT]: createNextProjectGenerator(),
  [ProjectType.VUE]: createVueProjectGenerator(),
  [ProjectType.NUXT]: createNuxtProjectGenerator(),
  [ProjectType.PREACT]: createPreactProjectGenerator(),
  [ProjectType.STENCIL]: createStencilProjectGenerator(),
  [ProjectType.ANGULAR]: createAngularProjectGenerator(),
  [ProjectType.REACTNATIVE]: createReactNativeProjectGenerator(),
  [ProjectType.GRIDSOME]: createGridsomeProjectGenerator(),
  [ProjectType.GATSBY]: createGatsbyProjectGenerator(),
  [ProjectType.HTML]: createHTMLProjectGenerator(),
}

const templates = {
  [ProjectType.REACT]: ReactTemplate,
  [ProjectType.NEXT]: NextTemplate,
  [ProjectType.VUE]: VueTemplate,
  [ProjectType.NUXT]: NuxtTemplate,
  [ProjectType.PREACT]: PreactTemplate,
  [ProjectType.STENCIL]: StencilTemplate,
  [ProjectType.REACTNATIVE]: ReactNativeTemplate,
  [ProjectType.ANGULAR]: AngularTemplate,
  [ProjectType.GRIDSOME]: GridsomeTemplate,
  [ProjectType.GATSBY]: GatsbyTemplate,
  [ProjectType.HTML]: HTMLTemplate,
}

/* tslint:disable ban-types */
const projectPublisherFactories: Omit<Record<PublisherType, Function>, PublisherType.DISK> = {
  [PublisherType.ZIP]: createZipPublisher,
  [PublisherType.VERCEL]: createVercelPublisher,
  [PublisherType.NETLIFY]: createNetlifyPublisher,
  [PublisherType.GITHUB]: createGithubPublisher,
  [PublisherType.CODESANDBOX]: createCodesandboxPublisher,
}

export const packProject: PackProjectFunction = async (
  projectUIDL,
  { projectType, publisher: publisherType, publishOptions = {}, assets = [], plugins = [] }
) => {
  const packer = createProjectPacker()
  let publisher
  if (publisherType === PublisherType.DISK) {
    if (isNodeProcess()) {
      const createDiskPublisher = await import('@teleporthq/teleport-publisher-disk').then(
        (mod) => mod.createDiskPublisher
      )
      publisher = createDiskPublisher
    } else {
      throw Error(`${PublisherType.DISK} can only be used inside node environments`)
    }
  } else {
    publisher = projectPublisherFactories[publisherType]
  }

  const projectGeneratorFactory = projectGeneratorFactories[projectType]
  projectGeneratorFactory.cleanPlugins()

  if (projectType === ProjectType.HTML) {
    projectGeneratorFactory.addPlugin(pluginImageResolver)
    projectGeneratorFactory.addPlugin(pluginCloneGlobals)
  }

  if (plugins?.length > 0) {
    plugins.forEach((plugin: ProjectPlugin) => {
      projectGeneratorFactory.addPlugin(plugin)
    })
  }

  const projectTemplate =
    projectType === ProjectType.PREACT && publisherType === PublisherType.CODESANDBOX
      ? PreactCodesandBoxTemplate
      : templates[projectType]

  if (!projectGeneratorFactory) {
    throw new InvalidProjectTypeError(projectType)
  }

  if (publisherType && !publisher) {
    throw new InvalidPublisherTypeError(publisherType)
  }

  packer.setAssets({
    assets,
    path: [Constants.ASSETS_IDENTIFIER],
  })

  packer.setGenerator(projectGeneratorFactory)
  packer.setTemplate(projectTemplate)

  // If no publisher is provided, the packer will return the generated project
  if (publisherType) {
    const publisherFactory = publisher
    const projectPublisher = publisherFactory(publishOptions)
    // @ts-ignore
    packer.setPublisher(projectPublisher)
  }

  return packer.pack(projectUIDL)
}

export const generateComponent: GenerateComponentFunction = async (
  componentUIDL: ComponentUIDL,
  {
    componentType = ComponentType.REACT,
    styleVariation = ReactStyleVariation.CSSModules,
    componentGeneratorOptions = {},
  }: {
    componentType?: ComponentType
    styleVariation?: ReactStyleVariation
    componentGeneratorOptions?: GeneratorOptions
  } = {}
) => {
  const generator = createComponentGenerator(componentType, styleVariation)
  const projectMapping = componentGeneratorProjectMappings[componentType]
  generator.addMapping(projectMapping as Mapping)

  if (componentType === ComponentType.HTML) {
    const { moduleComponents } = componentGeneratorOptions
    ;(generator as HTMLComponentGenerator).addExternalComponents({ externals: moduleComponents })
  }

  return generator.generateComponent(componentUIDL, componentGeneratorOptions)
}

const createComponentGenerator = (
  componentType: ComponentType,
  styleVariation: StyleVariation
): ComponentGenerator => {
  const generatorFactory = componentGeneratorFactories[componentType]

  if (!generatorFactory) {
    throw new Error(`Invalid ComponentType: ${componentType}`)
  }

  if (
    componentType === ComponentType.REACT ||
    componentType === ComponentType.PREACT ||
    componentType === ComponentType.REACTNATIVE
  ) {
    return generatorFactory({ variation: styleVariation })
  }

  return generatorFactory()
}
