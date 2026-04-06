import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function getConfiguredPrinterName() {
  return String(process.env.CASH_DRAWER_PRINTER_NAME || "").trim();
}

function buildPowerShellScript(printerName) {
  const encodedPrinterName = JSON.stringify(printerName || "");
  return `
$ErrorActionPreference = 'Stop'
$preferredPrinter = ${encodedPrinterName}

if ([string]::IsNullOrWhiteSpace($preferredPrinter)) {
  $preferredPrinter = (Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1 -ExpandProperty Name)
}

if ([string]::IsNullOrWhiteSpace($preferredPrinter)) {
  throw 'Default printer topilmadi'
}

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)]
    public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, DOCINFO di);

  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] bytes, Int32 count, out Int32 written);
}
"@

$handle = [IntPtr]::Zero
if (-not [RawPrinterHelper]::OpenPrinter($preferredPrinter, [ref]$handle, [IntPtr]::Zero)) {
  throw "Printer ochilmadi: $preferredPrinter"
}

try {
  $doc = New-Object RawPrinterHelper+DOCINFO
  $doc.pDocName = 'OpenCashDrawer'
  $doc.pDataType = 'RAW'

  if (-not [RawPrinterHelper]::StartDocPrinter($handle, 1, $doc)) {
    throw 'StartDocPrinter xatosi'
  }

  try {
    if (-not [RawPrinterHelper]::StartPagePrinter($handle)) {
      throw 'StartPagePrinter xatosi'
    }

    try {
      [byte[]]$bytes = 27,112,0,25,250
      $written = 0
      if (-not [RawPrinterHelper]::WritePrinter($handle, $bytes, $bytes.Length, [ref]$written)) {
        throw 'WritePrinter xatosi'
      }
    } finally {
      [void][RawPrinterHelper]::EndPagePrinter($handle)
    }
  } finally {
    [void][RawPrinterHelper]::EndDocPrinter($handle)
  }
} finally {
  [void][RawPrinterHelper]::ClosePrinter($handle)
}

Write-Output $preferredPrinter
`.trim();
}

export async function openCashDrawer() {
  const script = buildPowerShellScript(getConfiguredPrinterName());
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeout: 15000 },
  );

  return {
    ok: true,
    printerName: String(stdout || "").trim(),
  };
}
