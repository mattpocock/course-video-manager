// webpack's asset/resource loader (in Remotion's bundler config) turns a font
// import into the URL it serves the bundled file from.
declare module "*.woff2" {
  const url: string;
  export default url;
}
