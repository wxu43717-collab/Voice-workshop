using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading;

public static class ContractTests
{
    static void ExpectFailure(Action action) { try { action(); } catch { return; } throw new Exception("Expected rejection"); }
    public static int Main(string[] args)
    {
        string root = args[0], source = args[1]; Directory.CreateDirectory(root);
        if (Install.Source("sample/voice") != "https://github.com/sample/voice/releases/download/v0.1.0-preview/") throw new Exception("Version pin failed");
        if (Install.Source("https://github.com/sample/voice/releases/tag/v1") != "https://github.com/sample/voice/releases/download/v1/") throw new Exception("Release URL failed");
        ExpectFailure(() => Install.Source("https://example.com/sample/voice"));
        ExpectFailure(() => Install.Source("https://github.com/sample/voice?bad=true"));
        var upstream = new Asset { name = "model.bin", url = "https://huggingface.co/Systran/faster-whisper-small/resolve/main/model.bin" };
        if (Install.AssetUrl("https://github.com/sample/voice/", upstream) != upstream.url) throw new Exception("Official source routing failed");
        if (Install.AssetUrl("https://github.com/sample/voice/", new Asset { name = "app.zip" }) != "https://github.com/sample/voice/app.zip") throw new Exception("Application source routing failed");
        ExpectFailure(() => Install.AssetUrl("https://github.com/sample/voice/", new Asset { url = "https://example.com/model.bin" }));
        var occupied = Path.Combine(root, "occupied"); Directory.CreateDirectory(occupied); File.WriteAllText(Path.Combine(occupied, "mine.txt"), "keep");
        ExpectFailure(() => Install.CheckRoot(occupied));
        var zipPath = Path.Combine(root, "unsafe.zip");
        using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create)) using (var writer = new StreamWriter(zip.CreateEntry("../escaped.txt").Open())) writer.Write("bad");
        ExpectFailure(() => Install.Unzip(zipPath, Path.Combine(root, "extract"), CancellationToken.None));
        if (File.Exists(Path.Combine(root, "escaped.txt"))) throw new Exception("ZIP escaped");
        var original = Path.Combine(root, "payload.bin"); var path = Path.Combine(root, "download.bin");
        var bytes = File.ReadAllBytes(original); File.WriteAllBytes(path + ".part", new ArraySegment<byte>(bytes, 0, 12345).ToArray());
        var asset = new Asset { name = "payload.bin", bytes = bytes.Length, sha256 = Install.Hash(original) };
        Install.Download(source + "payload.bin", path, asset, (s,p) => {}, CancellationToken.None);
        if (!Install.Verified(path, asset.bytes, asset.sha256)) throw new Exception("Resume verification failed");
        File.WriteAllText(path, "corrupt");
        Install.Download(source + "payload.bin", path, asset, (s,p) => {}, CancellationToken.None);
        if (!Install.Verified(path, asset.bytes, asset.sha256)) throw new Exception("Corrupt cache was reused");
        File.Delete(path); var cancel = new CancellationTokenSource(); cancel.Cancel();
        ExpectFailure(() => Install.Download(source + "payload.bin", path, asset, (s,p) => {}, cancel.Token));
        asset.sha256 = new string('0', 64);
        ExpectFailure(() => Install.Download(source + "payload.bin", path, asset, (s,p) => {}, CancellationToken.None));
        if (File.Exists(path)) throw new Exception("Invalid checksum accepted");
        Console.WriteLine("PASS: source URLs, empty-directory protection, ZIP traversal, HTTP resume, corrupt cache, cancellation, checksum rejection.");
        return 0;
    }
}
