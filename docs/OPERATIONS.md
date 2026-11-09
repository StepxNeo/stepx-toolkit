# 本地运维与故障排查

## 运行与数据

本项目是单用户 localhost 服务，不使用外部数据库。备份 `STEPX_HOME` 前确认备份加密、访问控制；其中会话文件等价于账号密码。更换机器后凭据可能因风控失效，需要重新登录。不在公网部署，不用反向代理公开本地 API。

Web 与 `schedule run` 使用同一个 `daemon.lock`，每次签到流程使用 `workflow.lock`；内置调度另有 `schedule-claim.lock`。正常退出会删除锁，kill -9/断电可能遗留。**先检查对应 PID 是否仍在运行**，确认没有并发进程后，才手工删除数据目录对应 `.lock`。不得为了重试签到而无脑删除正在使用的锁。

定时失败只存简短摘要，不保存完整上游数据。`history.json` 最多200条；Web API 的成功调用与定时运行有记录，CLI直接调用结果输出终端，失败请求不保证单独落历史。需要审计请自己保护终端日志，不要共享原始身份/项目返回。

## systemd 用户服务

参考 `examples/stepx.service`，替换路径，用普通用户而不是 root 运行：

```bash
mkdir -p ~/.config/systemd/user
cp examples/stepx.service ~/.config/systemd/user/stepx.service
# 编辑 Node 及项目绝对路径后：
systemctl --user daemon-reload
systemctl --user enable --now stepx
systemctl --user status stepx
journalctl --user -u stepx
```

该示例启动 `schedule run`，不会提供Web页面，也不启动官方有头浏览器。需要Web常驻可将 ExecStart 改为 `node bin/stepx.js serve`，二者不要同时运行。用户登出后继续运行需了解系统 `loginctl enable-linger` 策略；不要未经理解修改系统策略。

## 常见问题

- **没有打开浏览器**：先 `npm run browser:install`；无桌面/无 DISPLAY 不能有头登录。在桌面电脑运行，或选择短信/导入。不要添加 `--no-sandbox` 规避浏览器安全机制。
- **403 / HTTP_ERROR / TASK_ERROR**：Cookie/token失效、任务域不匹配、风控或官方改版。先在官方页面检查，重新登录并 `auth verify`；不自动重试写操作。
- **Studio 通过、任务不通过**：不同域的会话可能不通用。SDK显式带Cookie也只是候选，只有 GetBalance 返回真实余额才算任务授权。不要把SDK初始化成功视为登录成功。
- **短信风控 405002/405003**：必须人工完成官方验证，切换官方浏览器，不自动解决图形/滑动验证码。
- **白名单拒绝**：账号暂无官方登录资格，停止并联系官方。不要换接口绕过。
- **短信发送成功后没收到**：不循环发送，检查号码/官方规则，等待后在官方页面处理。验证码只支持6位。
- **未知任务列表 / 未发现签到任务**：官方响应结构改动或没有任务，停止自动化，核对 `GetTaskList`，修改适配和对应测试后再用。
- **签到请求成功但核验未到账**：服务端可能延迟，先只读 `workflow inspect`，不要立即重复提交。项目不会伪造成功提示。
- **定时已启用但没执行**：检查进程常驻、系统时间、IANA时区、网络、Cookie和schedule.lastDate/lastResult。当日失败不自动重试；确认真实状态后可手工 `workflow all --yes`。
- **localhost 访问403**：有意只允许实际监听的 `127.0.0.1:端口` Host，用启动日志中的地址；刷新以更新CSRF。
- **保存/清除后凭据没变**：环境变量优先，检查 STEPX_COOKIE/STEPX_TOKEN。不要打印它们到共享终端。
- **依赖丢失**：在独立项目目录重新 `npm ci`，无需修改外层App。
- **API上传报错**：附件字段 `file`、头像字段 `avatar`，multipart 不和 JSON body 同时发送。本地HTTP请求上限12 MiB（Base64会增加约1/3体积），官方限额可能更小。
- **推断接口失败**：资料未验证真实入参，先用本人官方页面网络请求核对。不要提交真实身份证/文件做试探性测试。

## 验收建议

1. 全新目录 `npm ci`、测试、声明检查、构建。
2. 无凭据启动Web，检查真实空态、导出确认、CSRF/Host限制。
3. 本人官方登录并保存，CLI/Web各查询一次余额和任务。
4. 手动检查 → 签到一次 → 确认已完成与奖励，再次流程应跳过。
5. 启用未来时间调度，保持进程，确认当天只执行一次。
6. 失效会话、短信风控、网络超时不应出现虚假成功或自动重复提交。

这些真实账号步骤必须由账号持有人自行验收，本项目自动化测试不发送真实短信、不消耗积分。
