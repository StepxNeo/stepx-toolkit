# Contributing

1. 使用 Node22+，运行 `npm ci`。
2. 新增接口先核对官方请求与许可，只记录字段契约，不提交真实响应或账号资料。
3. 在 `src/endpoints.js` 标注来源验证状态，保持 SDK、CLI、Web 使用同一目录；更新 docs/API.md 和必要类型声明。
4. 为请求方法、路径编码、错误、超时/取消、敏感数据不泄漏增加 mock 测试。禁止CI真实发短信、登录、兑换、删除项目。
5. 提交前执行 `npm test && npm run typecheck && npm run build`；Web 改动还需用真实浏览器检查桌面和手机布局。
6. PR 写明行为变化、风险、兼容性、测试方法及结果。不自动重试不确定写请求，不绕过验证码/白名单，不默认将凭据发到新域名。

目前JavaScript保留轻量开发方式，`typecheck`校验模块与SDK声明但未启用全量checkJs。提升静态检查时应渐进补JSDoc，不应通过关闭已存在测试掩盖错误。
