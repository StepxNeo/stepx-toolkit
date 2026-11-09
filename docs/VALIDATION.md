# 本次交付验证

运行环境：Node v22.22.1，Linux。

已通过：

- `npm test`：82项（包含44项接口路由子测试、登录入口地址断言、逐接口用途检查及README/API表格同步检查），0失败。
- `npm run typecheck`：通过（模块与声明检查，未启用JavaScript全量checkJs）。
- `npm run build`：通过，检查语法、44项接口目录并输出dist/web。
- `npm run cli -- --help`：命令帮助正常。
- `npm audit --omit=dev --registry=https://registry.npmjs.org`：0 vulnerabilities；默认镜像审计接口连接失败后改用官方registry成功。
- `scripts/smoke-ui.mjs`：启动真实临时loopback后端和已安装Chromium；44接口加载、本地合成Cookie保存及清空输入、凭据默认隐藏、kit.list推荐查询、1440/390宽度无横向溢出、无pageerror。无官方网络请求。使用环境已有Chromium路径运行，没有重装浏览器。

生成的浏览器截图位于本地 `artifacts/`，已忽略，不打入开源归档。当前模型不支持图片输入，未声称做过截图的人工视觉审阅；布局验收依据浏览器DOM与溢出断言。

README 主题截图由 `scripts/screenshot.mjs` 用临时数据目录与**合成演示数据**（占位 Cookie、示例执行记录）渲染真实本地界面后写入 `docs/images/`，会随仓库提交；截图中不含真实账号或凭据，也不产生官方网络请求。

未执行：真实账号短信发送/验证码登录、官方浏览器人工登录、真实签到/兑换/项目写操作、官方当天任务或推断接口验证。此类操作需账号持有人本机执行，不能用mock测试结果替代。

自动测试与浏览器冒烟均使用临时本地数据目录，并在结束时停止后端/关闭浏览器/删除临时会话。不保留演示账号或真实凭据。项目未创建或推送远程GitHub仓库；README提供发布步骤。
