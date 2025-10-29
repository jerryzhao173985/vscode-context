// Type declarations for @npmcli/package-json
declare module '@npmcli/package-json' {
  export interface PackageJsonContent {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    engines?: Record<string, string>;
    [key: string]: any;
  }

  export class PackageJson {
    content: PackageJsonContent;
    static load(path: string): Promise<PackageJson>;
  }
}
