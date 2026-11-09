export interface Endpoint {
  readonly name: string; readonly group: string; readonly method: 'GET'|'POST'|'PATCH'|'DELETE';
  readonly path: string; readonly target: 'api'|'task'; readonly status: string; readonly description: string;
  /** 详细作用与调用注意事项（用于控制台详情和 README 接口表）。 */
  readonly purpose: string;
  readonly params?: Readonly<{path?: readonly string[]; query?: readonly string[]; files?: readonly string[]}>;
}
export const ENDPOINTS: readonly Endpoint[];
export const DEFAULT_API_ORIGIN: string;
export const DEFAULT_TASK_ORIGIN: string;
export type Query = Record<string, string|number|boolean|null|undefined|readonly (string|number|boolean|null|undefined)[]>;
export type Upload = Blob | {buffer: Blob|ArrayBuffer|ArrayBufferView; filename?: string; type?: string};
export interface BinaryResult {contentType: string; base64: string}
export interface CallOptions {path?: Record<string,string|number>; query?: Query; body?: unknown; files?: Record<string,Upload>; signal?: AbortSignal}
export interface ClientOptions {cookie?: string; token?: string; apiOrigin?: string; taskOrigin?: string; lang?: string; timeout?: number; minInterval?: number; headers?: HeadersInit; fetch?: typeof fetch}
export class StepXError extends Error {
  constructor(message: string, options?: {code?:string;status?:number;endpoint?:string;method?:string});
  code: string; status?: number; endpoint?: string; method?: string;
}
type Result = Promise<unknown>;
export class StepXClient {
  constructor(options?: ClientOptions);
  call<T=unknown>(name: string, options?: CallOptions): Promise<T>;
  identity: {me():Result; updateAvatar(file:Upload):Result};
  developer: {status():Result; profile():Result; sendSmsCode(body:unknown):Result; submitIdentity(body:unknown):Result; submitReview(body:unknown):Result; idImage(imageId:string|number,biz?:string):Result};
  projects: {list(query?:Query):Result; get(id:string|number):Result; activity():Result; publishedPlugins():Result; create(body:unknown):Result; update(id:string|number,body:unknown):Result; remove(id:string|number):Result; builderConfig(id:string|number):Result; updateBuilderConfig(id:string|number,patch:unknown):Result; dependencies(id:string|number):Result; generateIcon(body:unknown):Result; generateName(body:unknown):Result; rebindAttachments(id:string|number,body:unknown):Result};
  integrate: {connectors(query?:Query):Result; plugins(query?:Query):Result; disconnect(connectionId:string|number):Result};
  kit: {list(query?:{kind?:string;page?:number;pageSize?:number;search?:string;category?:string}):Result; detail(kind:string,name:string):Result; recommendations(kind:string,name:string,limit?:number):Result; thumbnail(kind:string,name:string,tag?:string):Promise<BinaryResult|unknown>};
  inbox: {list(query?:{limit?:number;cursor?:string}):Result; read(id:string|number):Result; readAll():Result};
  attachments: {upload(file:Upload,filename?:string):Result};
  models: {chat():Result; builder():Result; voices():Result; avatars():Result};
  task: {getBalance():Result; list():Result; sign():Result; journal(query?:{type?:number;offset?:number;limit?:number}):Result; gifts():Result; redeemOrders():Result; redeem(giftId:string|number):Result; firstEnter():Result};
}
export function createClient(options?: ClientOptions): StepXClient;
export function createClientFromEnv(options?: ClientOptions): StepXClient;
export default StepXClient;
