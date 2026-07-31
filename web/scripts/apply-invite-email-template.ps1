# Applies Total Service Pro invite email subject + HTML to Supabase Auth (hosted).
# Requires: SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)
#           PROJECT_REF (default: Total Service Pro)
#
# Usage:
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
#   .\scripts\apply-invite-email-template.ps1

$ErrorActionPreference = "Stop"
$ProjectRef = if ($env:PROJECT_REF) { $env:PROJECT_REF } else { "yljztfajyvjzqikxdddf" }
$Token = $env:SUPABASE_ACCESS_TOKEN
if (-not $Token) {
  Write-Error "Set SUPABASE_ACCESS_TOKEN first (Dashboard → Account → Access Tokens)."
}

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# script lives in web/scripts → web root is parent
$webRoot = Split-Path $PSScriptRoot -Parent
$subjectPath = Join-Path $webRoot "supabase\templates\invite_subject.txt"
$htmlPath = Join-Path $webRoot "supabase\templates\invite.html"

$subject = (Get-Content $subjectPath -Raw).Trim()
$html = Get-Content $htmlPath -Raw

$body = @{
  mailer_subjects_invite          = $subject
  mailer_templates_invite_content = $html
} | ConvertTo-Json -Depth 5

$uri = "https://api.supabase.com/v1/projects/$ProjectRef/config/auth"
Write-Host "PATCH $uri"
$res = Invoke-RestMethod -Method Patch -Uri $uri -Headers @{
  Authorization  = "Bearer $Token"
  "Content-Type" = "application/json"
} -Body $body

Write-Host "Updated invite subject + template."
Write-Host "Subject: $subject"
Write-Host "Template length: $($html.Length) chars"
