using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public class Asset { public string name, url; public long bytes; public string sha256; }
public class Package { public string id, name, file, sha256, target, format; public long bytes; public Asset[] parts; }
public class Release { public string version; public Package[] packages; }

public static class Install
{
    public static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    public static Release Manifest()
    {
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("release.json"))
        using (var reader = new StreamReader(stream)) return Json.Deserialize<Release>(reader.ReadToEnd());
    }
    public static string Source(string input)
    {
        var text = input.Trim().TrimEnd('/');
        if (!text.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) text = "https://github.com/" + text;
        Uri url;
        if (!Uri.TryCreate(text, UriKind.Absolute, out url) || url.Host != "github.com" || url.Scheme != "https" || url.Query != "" || url.Fragment != "")
            throw new Exception("请填写 GitHub 仓库地址或 Release 页面地址。");
        var segments = url.AbsolutePath.Trim('/').Split('/');
        if (segments.Length < 2 || segments.Take(2).Any(x => !System.Text.RegularExpressions.Regex.IsMatch(x, "^[A-Za-z0-9_.-]+$")))
            throw new Exception("仓库地址应为 github.com/账号/仓库名。");
        var repo = "https://github.com/" + segments[0] + "/" + segments[1];
        if (segments.Length == 2) return repo + "/releases/download/" + Manifest().version + "/";
        if (segments.Length >= 4 && segments[2] == "releases" && (segments[3] == "tag" || segments[3] == "download") && segments.Length == 5)
            return repo + "/releases/download/" + segments[4] + "/";
        throw new Exception("请粘贴仓库首页或具体版本的 Release 页面地址。");
    }
    public static string Hash(string file)
    {
        using (var sha = SHA256.Create()) using (var stream = File.OpenRead(file))
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    public static bool Verified(string file, long bytes, string sha) { return File.Exists(file) && new FileInfo(file).Length == bytes && Hash(file) == sha; }
    public static string AssetUrl(string source, Asset asset)
    {
        if (String.IsNullOrEmpty(asset.url)) return source + Uri.EscapeDataString(asset.name);
        var url = new Uri(asset.url);
        if (url.Scheme != "https" || url.Host != "huggingface.co") throw new IOException("模型下载地址必须来自官方 Hugging Face。");
        return asset.url;
    }
    public static void Download(string url, string path, Asset asset, Action<string, int> report, CancellationToken cancel)
    {
        if (Verified(path, asset.bytes, asset.sha256)) return;
        if (File.Exists(path)) File.Delete(path);
        var partial = path + ".part";
        if (File.Exists(partial) && new FileInfo(partial).Length >= asset.bytes) File.Delete(partial);
        Exception last = null;
        for (int attempt = 0; attempt < 4; attempt++)
        {
            cancel.ThrowIfCancellationRequested();
            try
            {
                long offset = File.Exists(partial) ? new FileInfo(partial).Length : 0;
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.UserAgent = "VoiceWorkshop-Setup/0.1";
                req.Timeout = 30000; req.ReadWriteTimeout = 30000;
                if (offset > 0) req.AddRange(offset);
                using (cancel.Register(() => req.Abort()))
                using (var response = (HttpWebResponse)req.GetResponse())
                {
                    if (offset > 0 && response.StatusCode == HttpStatusCode.OK) offset = 0;
                    if (response.StatusCode == HttpStatusCode.PartialContent && !response.Headers["Content-Range"].StartsWith("bytes " + offset + "-"))
                        throw new IOException("服务器返回了不正确的下载范围。");
                    using (var source = response.GetResponseStream())
                    using (var output = new FileStream(partial, offset == 0 ? FileMode.Create : FileMode.Append, FileAccess.Write))
                    {
                        var buffer = new byte[1024 * 1024]; int n; long have = offset;
                        var timer = Stopwatch.StartNew();
                        while ((n = source.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            cancel.ThrowIfCancellationRequested();
                            have += n;
                            if (have > asset.bytes) throw new IOException("下载大小异常。");
                            output.Write(buffer, 0, n);
                            if (timer.ElapsedMilliseconds > 250) { report(asset.name + "  " + (have / 1e9).ToString("0.00") + " / " + (asset.bytes / 1e9).ToString("0.00") + " GB", (int)(have * 100 / asset.bytes)); timer.Restart(); }
                        }
                    }
                }
                report("校验 " + asset.name, 100);
                if (!Verified(partial, asset.bytes, asset.sha256)) { File.Delete(partial); throw new IOException("文件校验失败，正在重新下载。"); }
                File.Move(partial, path); return;
            }
            catch (Exception e) { cancel.ThrowIfCancellationRequested(); last = e; report("下载中断，正在重试：" + asset.name, 0); if (cancel.WaitHandle.WaitOne(1000)) cancel.ThrowIfCancellationRequested(); }
        }
        throw new IOException("无法下载 " + asset.name + "。请检查 GitHub / Hugging Face 的网络连接。下次安装会继续下载。", last);
    }
    public static void Unzip(string file, string destination, CancellationToken cancel)
    {
        var prefix = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        Directory.CreateDirectory(prefix);
        using (var zip = ZipFile.OpenRead(file)) foreach (var entry in zip.Entries)
        {
            cancel.ThrowIfCancellationRequested();
            var target = Path.GetFullPath(Path.Combine(prefix, entry.FullName));
            if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new IOException("压缩包包含越界路径。");
            if (entry.FullName.EndsWith("/")) Directory.CreateDirectory(target);
            else { Directory.CreateDirectory(Path.GetDirectoryName(target)); entry.ExtractToFile(target, true); }
        }
    }
    public static void Run(string executable, string arguments, string root, Action<string, int> report, CancellationToken cancel)
    {
        var start = new ProcessStartInfo(executable, arguments) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
        start.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        using (var process = new Process { StartInfo = start })
        {
            var errors = new StringBuilder();
            process.OutputDataReceived += (s, e) => { if (!String.IsNullOrWhiteSpace(e.Data)) report(e.Data, -1); };
            process.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (errors) { if (errors.Length < 8000) errors.AppendLine(e.Data); } };
            process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
            while (!process.WaitForExit(200)) if (cancel.IsCancellationRequested)
            {
                using (var kill = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + process.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true })) kill.WaitForExit();
                process.WaitForExit(); cancel.ThrowIfCancellationRequested();
            }
            process.WaitForExit();
            if (process.ExitCode != 0) throw new Exception(Path.GetFileName(executable) + " 执行失败。" + Environment.NewLine + errors);
        }
    }
    public static void CheckRoot(string root)
    {
        if (root.StartsWith(@"\\")) throw new Exception("请选择本机磁盘上的文件夹。");
        if (Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any() && !File.Exists(Path.Combine(root, ".voice-install")))
            throw new Exception("请选择空文件夹，避免覆盖已有文件。之前由本安装器创建的目录可以继续安装。");
    }
    public static void Execute(string root, string source, bool rvc, bool training, bool shortcut, Action<string, int> report, CancellationToken cancel)
    {
        root = Path.GetFullPath(root); CheckRoot(root);
        Directory.CreateDirectory(root);
        using (var installLock = new FileStream(Path.Combine(root, ".voice-install"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
        {
            report("检查 NVIDIA 显卡驱动", -1);
            Run("nvidia-smi.exe", "-L", root, report, cancel);
            var manifest = Manifest();
            var selected = manifest.packages.Where(p => p.id != "rvc" || rvc).Where(p => !p.id.StartsWith("asr") || training).ToArray();
            var cache = Path.Combine(root, ".installer-cache"); Directory.CreateDirectory(cache);
            foreach (var package in selected)
            {
                cancel.ThrowIfCancellationRequested(); report("准备 " + package.name, 0);
                var archive = Path.Combine(cache, package.file);
                if (!Verified(archive, package.bytes, package.sha256))
                {
                    foreach (var part in package.parts) Download(AssetUrl(source, part), Path.Combine(cache, part.name), part, report, cancel);
                    if (package.parts.Length == 1 && package.parts[0].name == package.file) { }
                    else
                    {
                        report("正在合并 " + package.name, 0);
                        using (var output = File.Create(archive + ".joining")) foreach (var part in package.parts)
                        {
                            cancel.ThrowIfCancellationRequested();
                            using (var input = File.OpenRead(Path.Combine(cache, part.name))) input.CopyTo(output);
                        }
                        if (!Verified(archive + ".joining", package.bytes, package.sha256)) throw new IOException("合并后的文件校验失败。");
                        if (File.Exists(archive)) File.Delete(archive);
                        File.Move(archive + ".joining", archive);
                    }
                }
                report("正在安装 " + package.name + "，这可能需要几分钟", -1);
                var destination = Path.Combine(root, package.target);
                Directory.CreateDirectory(destination);
                if (package.format == "file") File.Copy(archive, Path.Combine(destination, package.file), true);
                else if (package.format == "zip") Unzip(archive, destination, cancel);
                else Run(Path.Combine(root, "tools", "7zr.exe"), "x \"" + archive + "\" -o\"" + destination + "\" -y -bsp0 -bso0", root, report, cancel);
                if (package.id == "gpt-sovits" || package.id == "rvc")
                {
                    var downloads = Path.Combine(root, "downloads"); Directory.CreateDirectory(downloads);
                    File.WriteAllText(Path.Combine(downloads, package.file + ".verified.json"), Json.Serialize(new { sha256 = package.sha256, bytes = package.bytes }));
                    File.WriteAllText(Path.Combine(destination, ".extracted"), package.file);
                }
            }
            report("检查显卡并配置运行环境", -1);
            var node = Path.Combine(root, "dist", "desktop", "node.exe");
            Run(node, "scripts/install-engines.mjs --engine=gpt-sovits", root, report, cancel);
            if (rvc) Run(node, "scripts/install-engines.mjs --engine=rvc", root, report, cancel);
            if (training)
            {
                var cfg = Json.Deserialize<Dictionary<string, Dictionary<string, object>>>(File.ReadAllText(Path.Combine(root, "config.local.json")));
                var engine = cfg["gpt-sovits"];
                Run(Path.Combine(root, (string)engine["python"]), "-c \"import faster_whisper, ctranslate2, soundfile, librosa; print('Training dependencies OK')\"", Path.Combine(root, (string)engine["root"]), report, cancel);
            }
            if (shortcut)
            {
                var shellType = Type.GetTypeFromProgID("WScript.Shell"); var shell = Activator.CreateInstance(shellType);
                var link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "声间配音.lnk") });
                var type = link.GetType();
                type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { Path.Combine(root, "dist", "desktop", "VoiceWorkshop.exe") });
                type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { root });
                type.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
                System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link); System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
            }
            File.WriteAllText(Path.Combine(root, "installed-version.json"), Json.Serialize(new { version = manifest.version, rvc, training, installedAt = DateTime.UtcNow }));
            report("安装完成。可以打开声间了。", 100);
        }
    }
}

public class SetupWindow : Form
{
    TextBox source = new TextBox(), folder = new TextBox();
    CheckBox rvc = new CheckBox(), training = new CheckBox();
    Label status = new Label(); ProgressBar progress = new ProgressBar();
    Button start = new Button(), browse = new Button(), stop = new Button();
    CancellationTokenSource cancellation; bool busy, complete;
    void LabelAt(string text, int y, int size, Color color) { Controls.Add(new Label { Text = text, Location = new Point(36, y), Size = new Size(635, size > 20 ? 50 : 38), Font = new Font("Microsoft YaHei UI", size), ForeColor = color }); }
    public SetupWindow()
    {
        Text = "声间 · 安装工作台"; ClientSize = new Size(710, 630); MinimumSize = MaximumSize = Size;
        StartPosition = FormStartPosition.CenterScreen; MaximizeBox = false; BackColor = Color.FromArgb(246,247,249); Font = new Font("Microsoft YaHei UI", 10); AutoScaleMode = AutoScaleMode.Dpi;
        LabelAt("声间  /  VOICE ATELIER", 28, 11, Color.DimGray);
        LabelAt("把声音工作台，装进你的电脑。", 65, 23, Color.FromArgb(28,32,38));
        LabelAt("首次下载，之后本地运行。无需另装 Node.js 或 Python。", 118, 10, Color.DimGray);
        LabelAt("GitHub 仓库或版本页面", 168, 10, Color.DimGray);
        source.SetBounds(38, 201, 632, 30); source.Text = "https://github.com/wxu43717-collab/Voice-workshop"; Controls.Add(source);
        LabelAt("安装位置 · 请选择空文件夹，建议预留 100 GB", 246, 10, Color.DimGray);
        folder.SetBounds(38, 279, 540, 30); folder.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VoiceWorkshop"); Controls.Add(folder);
        browse.Text = "选择…"; browse.SetBounds(588, 275, 82, 36); browse.Click += (s,e) => { using (var dialog = new FolderBrowserDialog()) { if (dialog.ShowDialog() == DialogResult.OK) folder.Text = Path.Combine(dialog.SelectedPath, "VoiceWorkshop"); } }; Controls.Add(browse);
        LabelAt("文字配音为必装组件，约 8.9 GB；其他功能可按需选择。", 331, 10, Color.DimGray);
        rvc.Text = "录音换声  +7.6 GB"; rvc.Checked = true; rvc.SetBounds(38,371,280,30); Controls.Add(rvc);
        training.Text = "音色训练  +0.5 GB"; training.Checked = true; training.SetBounds(355,371,280,30); Controls.Add(training);
        status.SetBounds(38,424,632,55); status.Text = "支持 Windows 10/11 x64、NVIDIA 显卡。当前整合包面向 RTX 50 系。"; Controls.Add(status);
        progress.SetBounds(38,484,632,8); Controls.Add(progress);
        start.Text = "下载并安装 →"; start.SetBounds(38,515,452,48); start.BackColor = Color.FromArgb(35,42,51); start.ForeColor = Color.White; start.FlatStyle = FlatStyle.Flat; start.Click += Start; Controls.Add(start);
        stop.Text = "暂停安装"; stop.Enabled = false; stop.SetBounds(510,515,160,48); stop.Click += (s,e) => { cancellation.Cancel(); stop.Enabled = false; status.Text = "正在停止；已下载的内容会保留。"; }; Controls.Add(stop);
        LabelAt("程序来自 GitHub，模型来自官方 Hugging Face。安装后可自行导入音色。", 578, 9, Color.DimGray);
        FormClosing += (s,e) => { if (busy) { e.Cancel = true; cancellation.Cancel(); status.Text = "正在停止安装，请稍后关闭。"; } };
    }
    void Report(string text, int percent)
    {
        if (IsDisposed) return;
        BeginInvoke((Action)(() => { status.Text = text; progress.Style = percent < 0 ? ProgressBarStyle.Marquee : ProgressBarStyle.Continuous; if (percent >= 0) progress.Value = Math.Max(0, Math.Min(100, percent)); }));
    }
    async void Start(object sender, EventArgs args)
    {
        if (complete) { Process.Start(Path.Combine(folder.Text, "dist", "desktop", "VoiceWorkshop.exe")); Close(); return; }
        try
        {
            var url = Install.Source(source.Text); var root = Path.GetFullPath(folder.Text); Install.CheckRoot(root);
            if (!Environment.Is64BitOperatingSystem) throw new Exception("需要 64 位 Windows。");
            if (new DriveInfo(Path.GetPathRoot(root)).AvailableFreeSpace < (rvc.Checked ? 100L : 60L) * 1024 * 1024 * 1024) throw new Exception("磁盘空间不足。完整安装请预留 100 GB，仅文字配音请预留 60 GB。");
            var installRvc = rvc.Checked; var installTraining = training.Checked;
            busy = true; cancellation = new CancellationTokenSource();
            source.Enabled = folder.Enabled = browse.Enabled = rvc.Enabled = training.Enabled = start.Enabled = false; stop.Enabled = true;
            await Task.Run(() => Install.Execute(root, url, installRvc, installTraining, true, Report, cancellation.Token));
            complete = true; start.Text = "打开声间 →"; status.Text = "安装完成，桌面快捷方式已创建。";
        }
        catch (OperationCanceledException) { status.Text = "已暂停。点击继续会复用已经下载的文件。"; start.Text = "继续安装 →"; }
        catch (Exception e)
        {
            status.Text = "安装未完成，可以检查后重试。"; start.Text = "重试安装 →";
            try { File.AppendAllText(Path.Combine(folder.Text, "setup-error.log"), DateTime.Now + " " + e + Environment.NewLine); } catch { }
            MessageBox.Show(e.Message, "安装提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        finally { busy = false; stop.Enabled = false; start.Enabled = true; if (!complete) source.Enabled = folder.Enabled = browse.Enabled = rvc.Enabled = training.Enabled = true; if (cancellation != null) cancellation.Dispose(); }
    }
    [STAThread]
    public static int Main(string[] args)
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        if (args.Length == 3 && args[0] == "--test-install")
        {
            try
            {
                var url = new Uri(args[2]); if (!url.IsLoopback) throw new Exception("Test source must be loopback.");
                Install.Execute(args[1], args[2], true, true, false, (text, percent) => File.AppendAllText(Path.Combine(args[1], "test-progress.log"), text + Environment.NewLine), CancellationToken.None);
                return 0;
            }
            catch (Exception e) { Directory.CreateDirectory(args[1]); File.WriteAllText(Path.Combine(args[1], "test-error.log"), e.ToString()); return 1; }
        }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        using (var window = new SetupWindow())
        {
            if (args.Length == 2 && args[0] == "--preview") { window.Show(); Application.DoEvents(); using (var bitmap = new Bitmap(window.Width, window.Height)) { window.DrawToBitmap(bitmap, new Rectangle(Point.Empty, window.Size)); bitmap.Save(args[1]); } return 0; }
            Application.Run(window);
        }
        return 0;
    }
}
