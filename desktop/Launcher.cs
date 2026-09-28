using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;

internal static class Launcher
{
    private const string Url = "http://127.0.0.1:3270";
    private static string Quote(string value) { return "\"" + value + "\""; }

    private static bool Ready()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(Url + "/api/state");
            request.Proxy = null;
            request.Timeout = 1500;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
            {
                var state = new JavaScriptSerializer().DeserializeObject(reader.ReadToEnd()) as System.Collections.Generic.Dictionary<string, object>;
                return state != null && state.ContainsKey("engines") && state.ContainsKey("voices") && state.ContainsKey("jobs");
            }
        }
        catch { return false; }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        var root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
        bool check = Array.IndexOf(args, "--check") >= 0;
        try
        {
            if (!File.Exists(Path.Combine(root, "server.mjs")))
                throw new Exception("找不到工作台项目，请保留原来的项目目录，并使用桌面快捷方式启动。");
            using (var mutex = new Mutex(false, "Local\\VoiceWorkshopDesktopStart"))
            {
                bool locked = false;
                try
                {
                    try { locked = mutex.WaitOne(45000); }
                    catch (AbandonedMutexException) { locked = true; }
                    if (!locked) throw new Exception("另一个工作台窗口正在启动，请稍后重试。");
                    if (!Ready())
                    {
                        var node = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "node.exe");
                        if (!File.Exists(node)) throw new Exception("桌面运行文件不完整，请重新运行安装脚本。");
                        var start = new ProcessStartInfo(node, Quote(Path.Combine(root, "desktop", "backend.cjs")));
                        start.WorkingDirectory = root;
                        start.UseShellExecute = false;
                        start.CreateNoWindow = true;
                        using (var bootstrap = Process.Start(start))
                        {
                            if (!bootstrap.WaitForExit(10000) || bootstrap.ExitCode != 0)
                                throw new Exception("后端启动失败，请查看 data/logs/desktop-server.log。");
                        }
                        var until = DateTime.UtcNow.AddSeconds(30);
                        while (!Ready())
                        {
                            if (DateTime.UtcNow >= until)
                                throw new Exception("后端未能启动，可能是端口 3270 被占用。请查看 data/logs/desktop-server.log。");
                            Thread.Sleep(300);
                        }
                    }
                }
                finally { if (locked) mutex.ReleaseMutex(); }
            }
            if (check) return 0;
            var browsers = new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe")
            };
            foreach (var browser in browsers)
            {
                if (!File.Exists(browser)) continue;
                var start = new ProcessStartInfo(browser, "--app=" + Url + " --user-data-dir=" + Quote(Path.Combine(root, "data", "desktop-browser")) + " --no-first-run --no-default-browser-check");
                start.UseShellExecute = false;
                Process.Start(start);
                return 0;
            }
            throw new Exception("请安装 Microsoft Edge 或 Google Chrome 后再打开工作台。");
        }
        catch (Exception error)
        {
            try { Directory.CreateDirectory(Path.Combine(root, "data", "logs")); File.AppendAllText(Path.Combine(root, "data", "logs", "desktop-launcher.log"), DateTime.Now + " " + error + Environment.NewLine); } catch { }
            if (!check) MessageBox.Show(error.Message, "声间 · 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
