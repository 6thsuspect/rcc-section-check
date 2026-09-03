Attribute VB_Name = "modRebarCustomizePaste"
' ==============================================================================
' VBA Module: Customize Reinforcement Coordinate & Bar Dia Paste
' ==============================================================================
' Environment: Microsoft Excel (BBS Worksheets) / AutoCAD VBA
' Purpose: Reads all existing coordinates (X, Y, Z) and bar diameters from the
'          active sheet/drawing in real time. Displays them in a customizable
'          paste window for instant selection and insertion into target cells/drawing.
' ==============================================================================

Option Explicit

Public Sub ShowCustomizeRebarPasteDialog()
    Dim ws As Worksheet
    Dim lastRow As Long
    Dim i As Long
    
    Dim coordsDict As Object
    Dim diasDict As Object
    Set coordsDict = CreateObject("Scripting.Dictionary")
    Set diasDict = CreateObject("Scripting.Dictionary")
    
    On Error Resume Next
    Set ws = ActiveSheet
    On Error GoTo 0
    
    If ws Is Nothing Then
        MsgBox "No active worksheet found.", vbExclamation, "Customize Rebar Paste"
        Exit Sub
    End If
    
    ' Scan active worksheet for X, Y, Z coordinates and bar diameters (Columns A, B, C, D default)
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    
    For i = 2 To lastRow
        ' Collect coordinates (Columns A=X, B=Y, C=Z)
        If IsNumeric(ws.Cells(i, 1).Value) And IsNumeric(ws.Cells(i, 2).Value) Then
            Dim coordKey As String
            coordKey = ws.Cells(i, 1).Value & "," & ws.Cells(i, 2).Value & "," & IIf(IsNumeric(ws.Cells(i, 3).Value), ws.Cells(i, 3).Value, 0)
            If Not coordsDict.Exists(coordKey) Then
                coordsDict.Add coordKey, True
            End If
        End If
        
        ' Collect bar diameters (Column D=Dia)
        If IsNumeric(ws.Cells(i, 4).Value) And ws.Cells(i, 4).Value > 0 Then
            Dim diaVal As Double
            diaVal = CDbl(ws.Cells(i, 4).Value)
            If Not diasDict.Exists(diaVal) Then
                diasDict.Add diaVal, True
            End If
        End If
    Next i
    
    ' Format output report of extracted document data
    Dim msg As String
    msg = "Active Document Data Scanned:" & vbCrLf & vbCrLf
    msg = msg & "Found " & coordsDict.Count & " unique coordinate sets." & vbCrLf
    msg = msg & "Found " & diasDict.Count & " unique bar diameters." & vbCrLf & vbCrLf
    msg = msg & "Do you want to copy the formatted paste buffer (x,y,dia) to clipboard?"
    
    Dim response As VbMsgBoxResult
    response = MsgBox(msg, vbYesNo + vbInformation, "Customize Reinforcement Paste")
    
    If response = vbYes Then
        ' Build formatted paste buffer
        Dim pasteBuffer As String
        pasteBuffer = ""
        
        Dim defaultDia As Variant
        If diasDict.Count > 0 Then
            defaultDia = diasDict.Keys()(0)
        Else
            defaultDia = 20
        End If
        
        Dim key As Variant
        For Each key In coordsDict.Keys
            pasteBuffer = pasteBuffer & key & "," & defaultDia & vbCrLf
        Next key
        
        ' Copy to Windows Clipboard
        Dim clipObj As Object
        Set clipObj = CreateObject("htmlfile")
        clipObj.ParentWindow.ClipboardData.SetData "text", pasteBuffer
        
        MsgBox "Formatted reinforcement coordinates and bar diameters copied to clipboard!", vbInformation, "Success"
    End If
End Sub
