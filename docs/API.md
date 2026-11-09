# StepX SDK API 与接口覆盖矩阵

本项目为独立 **Node.js 22 ESM** SDK；实现自行重写，不包含 `docs/reference/upstream-sdk.js` 的源码。上游材料未提供许可证，仅作为协议参考，不自动纳入本项目 MIT 授权范围。

> 原始文档逐表共 **44** 项，不是估计的约 47 项；下表全部实现。状态沿用参考材料，不表示本项目重新在线验证。尤其「推断」写操作的 body schema 未确定，使用前必须自行核实，不能将目录视为上游稳定性承诺。当前没有对真实账号执行破坏性操作。

## 导出与初始化

```js
import { createClient, createClientFromEnv, StepXClient, StepXError, ENDPOINTS } from './src/sdk.js';
const client = createClient({
  cookie: process.env.STEPX_COOKIE, // 完整原值，不拆分风控票据
  token: process.env.STEPX_TOKEN,   // 原值，不添加 Bearer
  timeout: 30000,
  minInterval: 300,               // 可设置 0（禁用节流）
  // fetch: customFetch,
});
const me = await client.identity.me();
const balance = await client.task.getBalance(); // data，例如 {balance:'270'}
```

必须提供非空 cookie 或 token；二者均提供时均发送。`headers` 可增加普通请求头，但不能覆盖显式 cookie/token。`lang` 默认 `zh`，请求头为 `zy-client-lang`。Cookie、Authorization 不会被 SDK 加前缀、裁切或改写（实际 HTTP fetch 会遵循平台 HTTP header 规范）。

默认 `apiOrigin = https://studio-api.stepx.com`；`taskOrigin = https://otter-gateway.stepaos.com/api/step.otter.zhiyueapp.api`。
可配置 HTTPS origin 或 HTTP `localhost` / `127.0.0.1` / `[::1]`，不允许用户名、密码、query、hash 或任意自定义路径。API 只接受域根；task 接受域根或固定 `/api/step.otter.zhiyueapp.api`，实际始终拼此固定目录。调用方负责信任自定义域名。

`createClientFromEnv(options={})` 读取 `STEPX_COOKIE`、`STEPX_TOKEN`、`STEPX_API_ORIGIN`、`STEPX_TASK_ORIGIN`、`STEPX_TIMEOUT`、`STEPX_MIN_INTERVAL`；options 覆盖环境变量。时间变量单位毫秒。timeout 必须 >0，minInterval 必须 ≥0，均要求有限数值且不大于 2147483647。

## 通用调用契约

```js
await client.call('projects.update', {
  path: {id:'p_123'},
  query: {flag:true, tag:['a','b']},
  body: {name:'新名字'},
  signal: abortController.signal,
});
await client.call('attachments.upload', {
  files: {file:{buffer:Buffer.from('hello'),filename:'hello.txt',type:'text/plain'}},
});
await client.call('identity.updateAvatar', {files:{avatar:new Blob([bytes],{type:'image/png'})}});
const image = await client.call('kit.thumbnail', {
  path:{kind:'template',name:'example'},query:{tag:'small'},
});
// 二进制: {contentType:'image/png',base64:'...'}
```

完整签名：`client.call(name, {path={},query={},body,files={},signal}={})`。

- name 必须来自 ENDPOINTS；不能传 URL、自定义 method 或任意路由。
- path 为占位名 → string/number；每段独立 URI 编码，`/ ? # %` 不可能逃逸目录；缺失、空值和单独 `.` / `..` 拒绝。
- query 支持 string/number/boolean 或这些类型的数组；数组重复键，忽略 null/undefined/空字符串，保留 0 和 false；通过 URLSearchParams 编码。
- files 为字段 → Blob 或 `{buffer,filename?,type?}`；buffer 支持 Node Buffer、TypedArray、ArrayBuffer、Blob。filename 默认 `file`（原生 Blob 使用 FormData 默认名）。SDK 自动生成 multipart boundary，不能同时传 body。
- 普通 body 用 JSON 编码。GET 不允许 body/files。`task.sign` 和 `task.firstEnter` 固定 POST JSON `{}`，无视调用者传入的 body；拒绝 files。
- API 返回解析后的 JSON（HTTP 204 空响应返回 null）。仅 `kit.thumbnail` 的非 JSON 非 text/XML 响应允许二进制，并返回 `{contentType,base64}`；缺失类型或 HTML 等非 JSON 文本视为错误，避免把登录页当缩略图。
- task 必须是非数组对象，拥有 numeric `code` 和 `data`，且 code 严格为 0 或 200 才返回 data；缺字段、字符串 code、非成功 code 一律失败。
- 不自动重试任何操作。默认每 client 两次请求启动至少相隔 300ms；并发共享节流队列，不跨 client。timeout 从入队开始，涵盖等待、fetch、读取完整响应；signal 可提前或处理中取消。
- redirect 始终 manual，所有 3xx 或已标记 redirected 响应均拒绝，绝不自动将凭据转发到另一个地址。自定义 fetch 必须遵守传入的 redirect/signal 契约；SDK 也对不响应 signal 的 fetch 做超时竞争，但无法强迫恶意注入函数停止其自身工作。
- 所有退出路径清理超时计时器、节流计时器及 SDK 注册的 abort 监听。

## 分组便利方法

原始 SDK 的方法名与位置参数保留。没有特殊参数的方法调用形式为 `client.<name>()`；所有方法对应同名目录项。

- `identity.updateAvatar(file)`。
- `developer.sendSmsCode(body)`、`submitIdentity(body)`、`submitReview(body)`、`idImage(imageId,biz='')`。
- `projects.list(query={})`、`get(id)`、`create(body)`、`update(id,body)`、`remove(id)`、`builderConfig(id)`、`updateBuilderConfig(id,patch)`、`dependencies(id)`、`generateIcon(body)`、`generateName(body)`。
- 新增 `projects.rebindAttachments(id,body)`；上游未明确 body 结构，不伪造 schema。
- `integrate.connectors(query={})`、`plugins(query={})`、`disconnect(connectionId)`。
- `kit.list({kind='template',page=1,pageSize=20,search='',category=''}={})` 将 pageSize 转成 page_size；当前仅 template 经上游实测。`detail(kind,name)`、`recommendations(kind,name,limit=3)`；新增 `thumbnail(kind,name,tag='')`。
- `inbox.list({limit=20,cursor=''}={})`、`read(id)`。
- `attachments.upload(file,filename?)`。
- `task.journal({type=1,offset=0,limit=20}={})`、`redeem(giftId)`（body 为 `{gift_id:String(giftId)}`）。

这些便利方法不新增最后一个 options 参数；需要 signal 或更自由 query/body 时使用 call。

## 错误契约

`StepXError` 仅携带 SDK 安全字段 `name,message,code,status?,endpoint?,method?`，不携带 URL、query、上游 response body、upstream msg、token/cookie 或原始 cause。HTTP_ERROR 不读取上游正文；TASK_ERROR 不透传上游业务 code/message，以免敏感内容进入 CLI 或本地 API 日志。

固定 code：`INVALID_ARGUMENT`、`UNKNOWN_ENDPOINT`、`TIMEOUT`、`ABORTED`、`REDIRECT_REJECTED`、`HTTP_ERROR`、`NETWORK_ERROR`、`INVALID_JSON`、`INVALID_ENVELOPE`、`TASK_ERROR`（手工构造错误默认 `SDK_ERROR`）。status 存在时是 HTTP status，不是 task 业务 code。不要将用户输入、原始凭据或上游响应另行拼回错误消息。

## 全量覆盖矩阵

ENDPOINTS 为冻结数组，每项 `{name,group,method,path,target,status,description,purpose,params?}`；`description` 为一句话用途，`purpose` 为详细作用与注意事项，params 可含 `path` / `query` / `files` 字符串数组，仅描述已知参数而不是完整验证 schema。下列 api 路径从 API origin 拼接，task 路径从固定 task gateway 目录拼接。

下表由 `npm run docs:api` 从 `src/endpoints.js` 生成。

<!-- API_MATRIX_START -->
| name | method | path | target | 作用 | 上游状态 |
| --- | --- | --- | --- | --- | --- |
| identity.me | GET | /api/identity/me | api | 读取当前登录账号资料（userId、昵称、头像、开发者状态等），用于确认 Cookie/token 是否仍然有效。 | 实测 |
| identity.updateAvatar | POST | /api/identity/me/avatar | api | 上传并替换当前账号头像，multipart 字段名为 avatar；会覆盖原头像，属于写操作。 | 推断 |
| developer.status | GET | /api/identity/developer/status | api | 查询开发者认证状态、当前流程步骤与驳回原因，只读。 | 实测 |
| developer.profile | GET | /api/identity/developer/profile | api | 读取已提交的实名/开发者认证资料（真实姓名、脱敏证件号、脱敏手机、邮箱），返回内容含隐私，注意日志脱敏。 | 实测（接口存在） |
| developer.sendSmsCode | POST | /api/identity/developer/sms-code | api | 发送「开发者认证」短信验证码，body 形如 {phone}；这不是登录短信，勿与登录流程混用。 | 推断 |
| developer.submitIdentity | POST | /api/identity/developer/identity | api | 提交实名/开发者认证资料，字段未实测；涉及真实身份信息，执行前务必核对官方页面请求。 | 推断 |
| developer.submitReview | POST | /api/identity/developer/review | api | 提交开发者认证审核，字段未实测；提交后可能进入人工审核流程，不能随意重复提交。 | 推断 |
| developer.idImage | GET | /api/identity/developer/id-images/:imageId | api | 按图片 ID 获取证件照地址，需带 biz 业务标识；返回的是敏感材料链接，不要外传。 | 推断 |
| projects.list | GET | /api/projects | api | 列出当前账号的项目，可附加查询条件过滤；项目较多时结果体较大。 | 实测 |
| projects.get | GET | /api/projects/:id | api | 按项目 ID 读取单个项目详情。 | 实测 |
| projects.activity | GET | /api/projects/activity | api | 读取项目的活跃/未读状态（构建状态、需关注原因、未读结果），用于判断是否有新产出。 | 实测 |
| projects.publishedPlugins | GET | /api/projects/published-plugins | api | 列出已发布为插件的项目。 | 实测（接口存在） |
| projects.create | POST | /api/projects | api | 新建项目，body 结构未实测；会占用账号项目配额。 | 推断 |
| projects.update | PATCH | /api/projects/:id | api | 修改项目（名称、配置等），body 结构未实测；只传需要变更的字段，避免覆盖其他配置。 | 推断 |
| projects.remove | DELETE | /api/projects/:id | api | 按项目 ID 请求删除项目；资料未明确恢复及关联数据处理规则，执行前务必备份并二次确认。 | 推断 |
| projects.builderConfig | GET | /api/projects/:id/builder-config | api | 读取项目的构建配置（启用的连接器、插件等），只读。 | 实测（代码确认） |
| projects.updateBuilderConfig | PATCH | /api/projects/:id/builder-config | api | 更新项目构建配置，方法为 PATCH，入参结构未实测；改动会影响后续构建。 | 代码确认 method |
| projects.dependencies | GET | /api/projects/:id/builder-dependencies | api | 读取项目的依赖变更信息（新增/变更的插件与连接器），只读。 | 实测（代码确认） |
| projects.generateIcon | POST | /api/projects/generate-icon | api | 调用 AI 为项目生成图标，body 未实测；可能消耗额度。 | 推断 |
| projects.generateName | POST | /api/projects/generate-name | api | 调用 AI 为项目生成名称，body 未实测；可能消耗额度。 | 推断 |
| projects.rebindAttachments | POST | /api/projects/:id/attachments/rebind | api | 把附件重新绑定到指定项目（原 SDK 缺失的接口），body 未实测；写操作。 | 推断 |
| integrate.connectors | GET | /api/integrate/connectors | api | 浏览连接器目录，可按 tab、builderType、mine、q 过滤；只读。 | 实测 |
| integrate.plugins | GET | /api/integrate/plugins | api | 浏览插件/技能目录，scope=discover 为发现页，mine=true 只看自己接入的；只读。 | 实测 |
| integrate.disconnect | DELETE | /api/integrate/connections/:connectionId | api | 取消某个连接器授权，可能影响依赖它的项目构建，不可撤销需重新授权。 | 代码确认 |
| kit.list | GET | /api/kit/items | api | 分页列出素材/模板。kind 目前仅 template 可用，page 从 1 开始，page_size 必填，否则返回 CORE_KIT_BAD_KIND 或参数错误。 | 实测 |
| kit.detail | GET | /api/kit/items/:kind/:name | api | 按 kind + name 读取单个素材/模板详情。 | 代码确认 |
| kit.recommendations | GET | /api/kit/items/:kind/:name/recommendations | api | 读取某素材的推荐列表，limit 默认 3。 | 代码确认 |
| kit.thumbnail | GET | /api/kit/items/:kind/:name/thumbnail | api | 读取素材缩略图，可能返回图片二进制（原 SDK 缺失的接口）；SDK 会转成 {contentType, base64} 以便 JSON 传输。 | 代码确认 |
| inbox.list | GET | /api/inbox | api | 分页读取站内信与未读数，cursor 用于翻页；只读。 | 实测 |
| inbox.read | PATCH | /api/inbox/:id/read | api | 把单条站内信标记为已读，写操作但影响很小。 | 代码确认 |
| inbox.readAll | PATCH | /api/inbox/read-all | api | 把全部站内信标记为已读，一次性影响所有未读消息。 | 代码确认 |
| models.chat | GET | /api/chat-models | api | 列出对话可用模型（含 isDefault 标记）。 | 实测 |
| models.builder | GET | /api/builder-models | api | 列出构建流程可选模型。 | 实测 |
| models.voices | GET | /api/builder-voices | api | 列出可用音色。 | 实测 |
| models.avatars | GET | /api/builder-avatars | api | 列出可用的头像素材。 | 代码确认 |
| attachments.upload | POST | /api/attachments | api | 上传附件，multipart 字段名为 file，返回附件引用供项目/聊天使用；会占用账号存储。 | 代码确认 |
| task.getBalance | GET | /GetBalance | task | 读取 A 豆余额，返回解包后的 {balance}；也是本项目校验任务域凭据是否有效的探针。 | 实测 |
| task.list | GET | /GetTaskList | task | 读取任务列表与完成/奖励状态。task_type：1 每日签到、2 活跃任务、3 设备权益；period_type：0 日、2 周/周期。 | 实测 |
| task.sign | POST | /Sign | task | 每日签到，必须 POST 空 JSON {}（原示例 SDK 误用 GET，本项目已修正）；是否重复签到由服务端判定。 | 代码确认 |
| task.journal | GET | /GetPointsJournal | task | 分页读取豆子收支流水，type 1 为收入、2 为支出，配合 offset/limit 翻页。 | 实测 |
| task.gifts | GET | /GetGiftList | task | 列出可兑换礼品、所需豆子、限购与已兑数量。 | 实测 |
| task.redeemOrders | GET | /GetRedeemOrderList | task | 列出历史兑换记录。 | 实测 |
| task.redeem | POST | /Redeem | task | 用豆子兑换礼品，body {gift_id}；会扣豆且通常不可撤销，本项目不会在签到或定时流程中调用。 | 推断 |
| task.firstEnter | POST | /FirstEnter | task | 提交任务页「首次进入」打点；签到完整流程会调用，但资料未确认它是否直接增加任务进度或奖励。 | 代码确认 |
<!-- API_MATRIX_END -->

## 测试

`node --test test/sdk.test.js`：独立固定的 44 路由期望表、每项 method、完整凭据原值、query/path 编码、multipart 文件内容/类型/名、task 信封、Sign POST {}、响应体读取超时、不协作 fetch 超时、abort 监听清理、真实 localhost redirect 不泄漏凭据、二进制 JSON 返回、非 JSON 与安全错误、分组默认参数、并发节流和取消队列。测试不需要真实 Cookie，不调用线上写接口。
