' AI 情报站启动器：自动发现 Node.js、启动本地服务并打开主页
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set env = sh.Environment("PROCESS")

Dim hub, scriptPath
hub = fso.GetParentFolderName(WScript.ScriptFullName) & "\"
scriptPath = hub & "server.js"

env("AI_HUB_DIR") = hub

Function ReadPort()
    ReadPort = 8437
    If fso.FileExists(hub & "port.txt") Then
        On Error Resume Next
        Dim p : p = Trim(fso.OpenTextFile(hub & "port.txt", 1).ReadAll)
        On Error GoTo 0
        If IsNumeric(p) Then ReadPort = CLng(p)
    End If
End Function

Function Alive(port)
    On Error Resume Next
    Dim h : Set h = CreateObject("MSXML2.ServerXMLHTTP")
    h.Open "GET", "http://127.0.0.1:" & port & "/api/ping", False
    h.setTimeouts 800, 800, 800, 800
    h.Send
    Alive = (Err.Number = 0 And h.status = 200)
    On Error GoTo 0
End Function

Function FindNode()
    Dim candidate, paths, i, path
    FindNode = ""

    ' 如果服务已运行，server.js 会记录上次使用的 Node.js 路径
    If fso.FileExists(hub & "node-path.txt") Then
        On Error Resume Next
        candidate = Trim(fso.OpenTextFile(hub & "node-path.txt", 1).ReadAll)
        On Error GoTo 0
        If Len(candidate) > 0 And fso.FileExists(candidate) Then
            FindNode = candidate
            Exit Function
        End If
    End If

    ' 先通过 PATH 查找，适用于标准 Node.js 安装
    On Error Resume Next
    candidate = sh.ExpandEnvironmentStrings("%PATH%")
    On Error GoTo 0
    paths = Split(candidate, ";")
    For i = 0 To UBound(paths)
        path = Trim(Replace(paths(i), Chr(34), ""))
        If Len(path) > 0 Then
            If LCase(Right(path, 9)) = "node.exe" And fso.FileExists(path) Then
                FindNode = path
                Exit Function
            End If
            If fso.FileExists(fso.BuildPath(path, "node.exe")) Then
                FindNode = fso.BuildPath(path, "node.exe")
                Exit Function
            End If
        End If
    Next

    ' PATH 未包含 Node.js 时尝试常用安装目录
    Dim common
    common = Array("C:\Program Files\nodejs\node.exe", "C:\nodejs\node.exe", "D:\nodejs\node.exe")
    For i = 0 To UBound(common)
        If fso.FileExists(common(i)) Then
            FindNode = common(i)
            Exit Function
        End If
    Next
End Function

Dim port
port = ReadPort()

If Not Alive(port) Then
    Dim nodeExe
    nodeExe = FindNode()
    If Len(nodeExe) = 0 Then
        MsgBox "没有找到 Node.js。请从 https://nodejs.org/ 安装 Node.js，再重新双击本启动器。", 48, "AI 情报站"
        WScript.Quit 1
    End If

    sh.Run """" & nodeExe & """ """" & scriptPath & """", 0, False
    Dim i
    For i = 1 To 40   ' 最多等待 10 秒
        WScript.Sleep 250
        port = ReadPort()
        If Alive(port) Then Exit For
    Next
End If

If Alive(port) Then
    sh.Run "http://127.0.0.1:" & port & "/"
Else
    MsgBox "AI 情报站服务启动失败。请确认 Node.js 已安装，或在命令行运行：node server.js", 48, "AI 情报站"
End If
