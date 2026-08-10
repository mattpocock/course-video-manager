"use client";

import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";
import { memo, useMemo } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { Element } from "hast";
import { GlobeIcon, HardDriveIcon, XIcon } from "lucide-react";
import { getRemovableRange, type BlockRange } from "./removable-block";
import {
  type BundledLanguage,
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
  type CodeBlockProps,
  CodeBlockSelect,
  CodeBlockSelectContent,
  CodeBlockSelectItem,
  CodeBlockSelectTrigger,
  CodeBlockSelectValue,
} from "../code-block";

export type RemoveBlockHandler = (range: BlockRange) => void;

export type AIResponseProps = HTMLAttributes<HTMLDivElement> & {
  options?: Options;
  children: Options["children"];
  imageBasePath: string;
  extraComponents?: Options["components"];
  preprocessMarkdown?: (md: string) => string;
  /**
   * When set, each paragraph, heading and list item grows an X button on hover
   * that reports the block's range in the markdown source. Offsets index into
   * the string this component parsed — i.e. after `preprocessMarkdown`.
   */
  onRemoveBlock?: RemoveBlockHandler;
};

/** Hover affordance for removing one rendered block from the source markdown. */
const RemoveBlockButton = ({ onRemove }: { onRemove: () => void }) => (
  <button
    type="button"
    aria-label="Remove"
    title="Remove"
    onClick={(event) => {
      event.preventDefault();
      onRemove();
    }}
    className="absolute right-0 top-0 hidden size-5 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm hover:text-destructive group-hover/md-block:flex"
  >
    <XIcon className="size-3" />
  </button>
);

const getComponents = (
  imageBasePath: string,
  onRemoveBlock: RemoveBlockHandler | undefined,
  customTagNames: ReadonlySet<string>
): Options["components"] => {
  /** Classes that turn a block into the hover target for its remove button. */
  const blockClass = onRemoveBlock ? "relative group/md-block" : undefined;

  const removeControl = (node: Element | undefined) => {
    if (!onRemoveBlock) return null;
    const range = getRemovableRange(node, customTagNames);
    if (!range) return null;
    return <RemoveBlockButton onRemove={() => onRemoveBlock(range)} />;
  };

  return {
    p: ({ node, children, className, ...props }) => (
      <p className={cn("mb-4", blockClass, className)} {...props}>
        {children}
        {removeControl(node)}
      </p>
    ),
    ol: ({ node, children, className, ...props }) => (
      <ol
        className={cn("ml-4 list-outside list-decimal", className)}
        {...props}
      >
        {children}
      </ol>
    ),
    li: ({ node, children, className, ...props }) => (
      <li className={cn("py-1", blockClass, className)} {...props}>
        {children}
        {removeControl(node)}
      </li>
    ),
    ul: ({ node, children, className, ...props }) => (
      <ul
        className={cn("ml-4 list-outside list-decimal", className)}
        {...props}
      >
        {children}
      </ul>
    ),
    strong: ({ node, children, className, ...props }) => (
      <span className={cn("font-semibold", className)} {...props}>
        {children}
      </span>
    ),
    a: ({ node, children, className, ...props }) => (
      <a
        className={cn("font-medium text-primary underline", className)}
        rel="noreferrer"
        target="_blank"
        {...props}
      >
        {children}
      </a>
    ),
    h1: ({ node, children, className, ...props }) => (
      <h1
        className={cn(
          "mt-6 mb-2 font-semibold text-3xl",
          blockClass,
          className
        )}
        {...props}
      >
        {children}
        {removeControl(node)}
      </h1>
    ),
    h2: ({ node, children, className, ...props }) => (
      <h2
        className={cn(
          "mt-6 mb-2 font-semibold text-2xl",
          blockClass,
          className
        )}
        {...props}
      >
        {children}
        {removeControl(node)}
      </h2>
    ),
    h3: ({ node, children, className, ...props }) => (
      <h3
        className={cn("mt-6 mb-2 font-semibold text-xl", blockClass, className)}
        {...props}
      >
        {children}
        {removeControl(node)}
      </h3>
    ),
    h4: ({ node, children, className, ...props }) => (
      <h4
        className={cn("mt-6 mb-2 font-semibold text-lg", blockClass, className)}
        {...props}
      >
        {children}
        {removeControl(node)}
      </h4>
    ),
    h5: ({ node, children, className, ...props }) => (
      <h5
        className={cn(
          "mt-6 mb-2 font-semibold text-base",
          blockClass,
          className
        )}
        {...props}
      >
        {children}
        {removeControl(node)}
      </h5>
    ),
    h6: ({ node, children, className, ...props }) => (
      <h6
        className={cn("mt-6 mb-2 font-semibold text-sm", blockClass, className)}
        {...props}
      >
        {children}
        {removeControl(node)}
      </h6>
    ),
    pre: ({ node, className, children }) => {
      let language = "javascript";

      if (typeof node?.properties?.className === "string") {
        language = node.properties.className.replace("language-", "");
      }

      const childrenIsCode =
        typeof children === "object" &&
        children !== null &&
        "type" in children &&
        children.type === "code";

      if (!childrenIsCode) {
        return <pre>{children}</pre>;
      }

      const data: CodeBlockProps["data"] = [
        {
          language,
          filename: "index.js",
          code: (children.props as { children: string }).children,
        },
      ];

      return (
        <CodeBlock
          className={cn("my-4 h-auto", className)}
          data={data}
          defaultValue={data[0]!.language}
        >
          <CodeBlockHeader>
            <CodeBlockFiles>
              {(item) => (
                <CodeBlockFilename key={item.language} value={item.language}>
                  {item.filename}
                </CodeBlockFilename>
              )}
            </CodeBlockFiles>
            <CodeBlockSelect>
              <CodeBlockSelectTrigger>
                <CodeBlockSelectValue />
              </CodeBlockSelectTrigger>
              <CodeBlockSelectContent>
                {(item) => (
                  <CodeBlockSelectItem
                    key={item.language}
                    value={item.language}
                  >
                    {item.language}
                  </CodeBlockSelectItem>
                )}
              </CodeBlockSelectContent>
            </CodeBlockSelect>
            <CodeBlockCopyButton
              onCopy={() => console.log("Copied code to clipboard")}
              onError={() => console.error("Failed to copy code to clipboard")}
            />
          </CodeBlockHeader>
          <CodeBlockBody>
            {(item) => (
              <CodeBlockItem key={item.language} value={item.language}>
                <CodeBlockContent language={item.language as BundledLanguage}>
                  {item.code}
                </CodeBlockContent>
              </CodeBlockItem>
            )}
          </CodeBlockBody>
        </CodeBlock>
      );
    },
    img: ({ node, children, className, ...props }) => {
      const isExternalUrl =
        props.src?.startsWith("http://") || props.src?.startsWith("https://");
      const src = isExternalUrl
        ? props.src
        : `/view-image?imagePath=${imageBasePath}/${props.src}`;
      return (
        <div className="relative my-6 aspect-video">
          <img
            {...props}
            className={cn("w-full h-full object-contain", className)}
            src={src}
          />
          <div
            className={cn(
              "absolute top-2 right-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium shadow-sm",
              isExternalUrl
                ? "bg-blue-500/80 text-white"
                : "bg-amber-500/80 text-white"
            )}
            title={isExternalUrl ? "External image (web)" : "Local image"}
          >
            {isExternalUrl ? (
              <>
                <GlobeIcon className="size-3" />
                <span>Web</span>
              </>
            ) : (
              <>
                <HardDriveIcon className="size-3" />
                <span>Local</span>
              </>
            )}
          </div>
        </div>
      );
    },
  };
};

export const AIResponse = memo(
  ({
    className,
    options,
    children,
    extraComponents,
    preprocessMarkdown,
    onRemoveBlock,
    ...props
  }: AIResponseProps) => {
    // Blocks that merely host one of these overrides are not prose, so they do
    // not get a remove control of their own.
    const customTagNames = useMemo(
      () => new Set(Object.keys(extraComponents ?? {})),
      [extraComponents]
    );

    const baseComponents = useMemo(
      () => getComponents(props.imageBasePath, onRemoveBlock, customTagNames),
      [props.imageBasePath, onRemoveBlock, customTagNames]
    );

    const components = useMemo(
      () =>
        extraComponents
          ? { ...baseComponents, ...extraComponents }
          : baseComponents,
      [baseComponents, extraComponents]
    );

    const processedChildren = useMemo(
      () =>
        preprocessMarkdown && typeof children === "string"
          ? preprocessMarkdown(children)
          : children,
      [children, preprocessMarkdown]
    );

    const rehypePlugins = extraComponents ? [rehypeRaw] : [];

    return (
      <div
        className={cn(
          "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 relative group",
          className
        )}
        {...props}
      >
        <ReactMarkdown
          components={components}
          remarkPlugins={[remarkGfm]}
          rehypePlugins={rehypePlugins}
          {...options}
        >
          {processedChildren}
        </ReactMarkdown>
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.extraComponents === nextProps.extraComponents &&
    prevProps.onRemoveBlock === nextProps.onRemoveBlock
);
