using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

namespace FbAdsDashboardSentinel
{
    public class SentinelService : ServiceBase
    {
        private readonly Dictionary<string, string> options;
        private Process child;
        private string logFile;
        private bool stopping;

        public SentinelService(Dictionary<string, string> options)
        {
            this.options = options;
            ServiceName = GetOption("service-name", "FbAdsDashboardSentinel");
            CanStop = true;
            CanShutdown = true;
            AutoLog = true;
        }

        protected override void OnStart(string[] args)
        {
            StartSentinel();
        }

        protected override void OnStop()
        {
            StopSentinel();
        }

        protected override void OnShutdown()
        {
            StopSentinel();
        }

        private void StartSentinel()
        {
            string nodePath = GetRequiredOption("node");
            string repoRoot = GetRequiredOption("repo");
            string scriptPath = GetRequiredOption("script");
            string logDir = Path.Combine(repoRoot, "logs");
            Directory.CreateDirectory(logDir);
            logFile = Path.Combine(logDir, "windows-service-wrapper.log");

            WriteLog("starting sentinel");
            stopping = false;
            child = new Process();
            child.StartInfo.FileName = nodePath;
            child.StartInfo.Arguments = Quote(scriptPath);
            child.StartInfo.WorkingDirectory = repoRoot;
            child.StartInfo.UseShellExecute = false;
            child.StartInfo.RedirectStandardOutput = true;
            child.StartInfo.RedirectStandardError = true;
            child.StartInfo.CreateNoWindow = true;
            child.EnableRaisingEvents = true;
            child.OutputDataReceived += (sender, eventArgs) => { if (eventArgs.Data != null) WriteLog(eventArgs.Data); };
            child.ErrorDataReceived += (sender, eventArgs) => { if (eventArgs.Data != null) WriteLog(eventArgs.Data); };
            child.Exited += (sender, eventArgs) => {
                int exitCode = 0;
                try
                {
                    exitCode = child.ExitCode;
                }
                catch
                {
                    exitCode = -1;
                }
                WriteLog("sentinel exited code=" + exitCode);
                if (!stopping)
                {
                    Environment.Exit(1);
                }
            };
            child.Start();
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
            WriteLog("sentinel pid=" + child.Id);
        }

        private void StopSentinel()
        {
            if (child == null)
            {
                return;
            }

            try
            {
                stopping = true;
                if (!child.HasExited)
                {
                    WriteLog("stopping sentinel pid=" + child.Id);
                    Process killer = Process.Start(new ProcessStartInfo
                    {
                        FileName = "taskkill.exe",
                        Arguments = "/PID " + child.Id + " /T /F",
                        UseShellExecute = false,
                        CreateNoWindow = true
                    });
                    if (killer != null)
                    {
                        killer.WaitForExit(10000);
                    }
                    child.WaitForExit(10000);
                }
            }
            catch (Exception ex)
            {
                WriteLog("failed to stop sentinel: " + ex.Message);
            }
            finally
            {
                child.Dispose();
                child = null;
            }
        }

        private string GetOption(string key, string fallback)
        {
            string value;
            return options.TryGetValue(key, out value) && !String.IsNullOrWhiteSpace(value) ? value : fallback;
        }

        private string GetRequiredOption(string key)
        {
            string value = GetOption(key, "");
            if (String.IsNullOrWhiteSpace(value))
            {
                throw new InvalidOperationException("Missing required option --" + key);
            }
            return value;
        }

        private static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private void WriteLog(string message)
        {
            try
            {
                string path = logFile;
                if (String.IsNullOrWhiteSpace(path))
                {
                    string repoRoot = GetOption("repo", AppDomain.CurrentDomain.BaseDirectory);
                    string logDir = Path.Combine(repoRoot, "logs");
                    Directory.CreateDirectory(logDir);
                    path = Path.Combine(logDir, "windows-service-wrapper.log");
                }
                File.AppendAllText(path, DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine);
            }
            catch
            {
                // Windows service logging must not block service start/stop.
            }
        }
    }

    internal static class Program
    {
        private static void Main(string[] args)
        {
            Dictionary<string, string> options = ParseArgs(args);
            if (options.ContainsKey("console"))
            {
                RunConsole(options);
                return;
            }
            ServiceBase.Run(new SentinelService(options));
        }

        private static Dictionary<string, string> ParseArgs(string[] args)
        {
            Dictionary<string, string> options = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < args.Length; i++)
            {
                string current = args[i] ?? "";
                if (!current.StartsWith("--", StringComparison.Ordinal))
                {
                    continue;
                }
                string key = current.Substring(2);
                if (String.Equals(key, "console", StringComparison.OrdinalIgnoreCase))
                {
                    options[key] = "true";
                    continue;
                }
                if (i + 1 < args.Length && !(args[i + 1] ?? "").StartsWith("--", StringComparison.Ordinal))
                {
                    options[key] = args[++i];
                }
                else
                {
                    options[key] = "";
                }
            }
            return options;
        }

        private static void RunConsole(Dictionary<string, string> options)
        {
            string nodePath = Require(options, "node");
            string repoRoot = Require(options, "repo");
            string scriptPath = Require(options, "script");
            Process process = Process.Start(new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = "\"" + scriptPath.Replace("\"", "\\\"") + "\"",
                WorkingDirectory = repoRoot,
                UseShellExecute = false
            });
            if (process != null)
            {
                process.WaitForExit();
                Environment.ExitCode = process.ExitCode;
            }
        }

        private static string Require(Dictionary<string, string> options, string key)
        {
            string value;
            if (!options.TryGetValue(key, out value) || String.IsNullOrWhiteSpace(value))
            {
                throw new InvalidOperationException("Missing required option --" + key);
            }
            return value;
        }
    }
}
