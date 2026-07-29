# 发布到 Visual Studio Marketplace

此仓库的 GitHub Actions 工作流会在推送匹配 `v*` 的 Git 标签时，构建并发布与标签版本完全一致的 VSIX。

## 一次性前置条件

### 1. 创建 Marketplace Publisher

1. 打开 [Visual Studio Marketplace publisher management](https://marketplace.visualstudio.com/manage)。
2. 使用与 Azure DevOps PAT 相同的 Microsoft 账户登录。
3. 选择 **Create publisher**，填写永久 Publisher ID：`lingyenbird`。
4. 确认其 ID 与 `package.json` 中的 `publisher` 值完全一致。

Publisher ID 会成为扩展标识 `lingyenbird.colored-folder-background` 的一部分，创建后不能改名。

### 2. 创建发布令牌

Visual Studio Marketplace 通过 Azure DevOps 认证。创建 Azure DevOps Personal Access Token（PAT）时：

- Organization：**All accessible organizations**；
- Scopes：选择 **Custom defined**，在 **Marketplace** 中授予 **Manage**；
- 妥善保存令牌，创建后它只显示一次。

然后在 GitHub 仓库中设置：

```text
Settings → Secrets and variables → Actions → New repository secret
Name: VSCE_PAT
Value: <Azure DevOps PAT>
```

工作流只从 `secrets.VSCE_PAT` 读取令牌，绝不会将其写入日志。

> Azure DevOps 已宣布在 2026-12-01 停用全局 PAT。当前工作流使用官方仍支持的 PAT 路径；在 Marketplace 提供与当前 `vsce` 版本兼容的 GitHub OIDC 可信发布配置后，应迁移到短期凭据。

## 发布版本

1. 更新 `package.json` 的 `version`，例如 `0.4.1`。
2. 构建并检查包：

   ```powershell
   pnpm install --frozen-lockfile
   pnpm run package
   ```

3. 提交版本变更，创建与版本严格一致的 Git 标签：

   ```powershell
   git tag v0.4.1
   git push origin main --tags
   ```

4. GitHub Actions 的 **Publish VS Code Extension** 工作流会：
   - 验证标签为 `v<package.json version>`；
   - 使用锁定依赖安装、编译和生成 VSIX；
   - 使用 `VSCE_PAT` 调用 `vsce publish --packagePath`；
   - 对已存在的相同版本安全跳过。

## 本地首次发布

配置好 Publisher ID 和 PAT 后，也可以先在本机发布一次：

```powershell
$env:VSCE_PAT = '<Azure DevOps PAT>'
pnpm exec vsce publish --packagePath .\colored-folder-background-<version>.vsix --pat $env:VSCE_PAT
```

本地发布后仍应通过 Git 标签让 CI 成为后续发布的唯一入口。
