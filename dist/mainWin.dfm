object mainWin: TmainWin
  Left = 109
  Top = 6
  Cursor = crArrow
  Caption = 'InteractiveBOM Suite V1.0.00'
  ClientHeight = 452
  ClientWidth = 452
  Color = clBtnFace
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -11
  Font.Name = 'Tahoma'
  Font.Style = []
  OldCreateOrder = False
  Scaled = False
  OnShow = mainWinShow
  FormKind = fkNormal
  PixelsPerInch = 96
  TextHeight = 13
  object PageControl1: TPageControl
    Left = 8
    Top = 8
    Width = 440
    Height = 440
    ActivePage = TabSheet1
    TabOrder = 0
    object TabSheet1: TTabSheet
      Caption = #24120#35268
      object GroupBox1: TGroupBox
        Left = 7
        Top = 9
        Width = 413
        Height = 63
        Caption = 'BOM '#36755#20986#20301#32622
        TabOrder = 0
        object BtnSave: TButton
          Left = 373
          Top = 22
          Width = 32
          Height = 26
          Caption = '...'
          TabOrder = 0
          OnClick = BtnSaveClick
        end
        object TEditCurrentPcbPath: TEdit
          Left = 61
          Top = 24
          Width = 304
          Height = 21
          ReadOnly = True
          TabOrder = 1
        end
      end
      object StaticText1: TStaticText
        Left = 18
        Top = 37
        Width = 48
        Height = 17
        Caption = #30446#24405
        TabOrder = 1
      end
      object GroupBox3: TGroupBox
        Left = 7
        Top = 81
        Width = 413
        Height = 111
        Caption = #38468#21152' PCB '#25968#25454
        TabOrder = 2
        object CbIncludeTracksAndSolidPolygons: TCheckBox
          Left = 14
          Top = 27
          Width = 167
          Height = 17
          Caption = #21253#21547#36208#32447'/'#23454#24515#35206#38108
          TabOrder = 0
        end
        object CbIncludeVias: TCheckBox
          Left = 14
          Top = 55
          Width = 87
          Height = 17
          Caption = #21253#21547#36807#23380
          TabOrder = 1
        end
        object CbIncludeInner: TCheckBox
          Left = 206
          Top = 27
          Width = 167
          Height = 17
          Caption = #21253#21547#20869#23618
          Checked = True
          State = cbChecked
          TabOrder = 2
        end
        object CbIncludeNets: TCheckBox
          Left = 206
          Top = 55
          Width = 87
          Height = 17
          Caption = #21253#21547#32593#32476
          Checked = True
          State = cbChecked
          TabOrder = 3
        end
        object CbIncludeSchematic: TCheckBox
          Left = 14
          Top = 83
          Width = 300
          Height = 17
          Caption = #21253#21547#21407#29702#22270#65288#31163#32447' SchDoc'#65289
          Checked = True
          State = cbChecked
          TabOrder = 4
        end
      end
      object GroupBox4: TGroupBox
        Left = 7
        Top = 201
        Width = 413
        Height = 103
        Caption = #20803#20214#25490#38500#35268#21017
        TabOrder = 3
        object CbBlacklistEmpty: TCheckBox
          Left = 14
          Top = 35
          Width = 207
          Height = 17
          Caption = #27880#37322#20026' "DNP"|""|"~" '#30340#20803#20214
          Checked = True
          State = cbChecked
          TabOrder = 0
        end
        object CbBlacklist1Pad: TCheckBox
          Left = 238
          Top = 35
          Width = 135
          Height = 17
          Caption = #21333#28938#30424#20803#20214
          Checked = True
          State = cbChecked
          TabOrder = 1
        end
        object CbBlacklistTh: TCheckBox
          Left = 14
          Top = 67
          Width = 135
          Height = 17
          Caption = #30452#25554#65288'TH'#65289#20803#20214
          Checked = True
          State = cbChecked
          TabOrder = 2
        end
        object CbBlacklistNoBOM: TCheckBox
          Left = 238
          Top = 67
          Width = 165
          Height = 17
          Caption = #26080' BOM '#20803#20214
          Checked = True
          State = cbChecked
          TabOrder = 3
        end
      end
      object GenerateBom: TButton
        Left = 336
        Top = 387
        Width = 80
        Height = 25
        Caption = #29983#25104'BOM'
        TabOrder = 4
        OnClick = GenerateBomClick
      end
      object GroupBox10: TGroupBox
        Left = 7
        Top = 313
        Width = 413
        Height = 58
        Caption = 'PCB '#36793#26694#23618
        TabOrder = 5
        object RBtnKeepOutLayer: TRadioButton
          Left = 14
          Top = 28
          Width = 111
          Height = 17
          Caption = #31105#27490#24067#32447#23618
          TabOrder = 0
        end
        object RBtnMech1: TRadioButton
          Left = 206
          Top = 28
          Width = 113
          Height = 17
          Caption = #26426#26800#23618'1'
          TabOrder = 1
        end
      end
    end
    object TabSheet2: TTabSheet
      Caption = #32593#39029#40664#35748
      ExplicitLeft = 0
      ExplicitTop = 0
      ExplicitWidth = 0
      ExplicitHeight = 0
      object CbDarkMode: TCheckBox
        Left = 14
        Top = 15
        Width = 87
        Height = 17
        Caption = #28145#33394#27169#24335
        TabOrder = 0
      end
      object CbShowFootprintPads: TCheckBox
        Left = 126
        Top = 15
        Width = 118
        Height = 17
        Caption = #26174#31034#28938#30424
        Checked = True
        State = cbChecked
        TabOrder = 1
      end
      object CbShowFabricationLayer: TCheckBox
        Left = 262
        Top = 15
        Width = 134
        Height = 17
        Caption = #26174#31034#39044#21046#23618
        TabOrder = 2
      end
      object CbShowSilkscreen: TCheckBox
        Left = 14
        Top = 47
        Width = 94
        Height = 17
        Caption = #26174#31034#19997#21360
        Checked = True
        State = cbChecked
        TabOrder = 3
      end
      object CbHighlightFirstPin: TCheckBox
        Left = 126
        Top = 47
        Width = 102
        Height = 17
        Caption = #39640#20142' 1 '#33050
        TabOrder = 4
      end
      object CbContinuousRedrawOnDrag: TCheckBox
        Left = 262
        Top = 47
        Width = 158
        Height = 17
          Caption = #25302#21160#26102#36830#32493#37325#32472
          Checked = True
          State = cbChecked
          TabOrder = 5
        end
      object CbShowReferences: TCheckBox
        Left = 14
        Top = 79
        Width = 87
        Height = 17
        Caption = #20301#21495
        Checked = True
        State = cbChecked
        TabOrder = 6
      end
      object CbShowValues: TCheckBox
        Left = 126
        Top = 79
        Width = 102
        Height = 17
        Caption = #21442#25968#20540
        Checked = True
        State = cbChecked
        TabOrder = 7
      end
      object CbShowTracks: TCheckBox
        Left = 262
        Top = 79
        Width = 102
        Height = 17
        Caption = #36208#32447
        Checked = True
        State = cbChecked
        TabOrder = 8
      end
      object CbShowZones: TCheckBox
        Left = 14
        Top = 111
        Width = 87
        Height = 17
        Caption = #38138#38108
        Checked = True
        State = cbChecked
        TabOrder = 9
      end
      object CbShowNetNames: TCheckBox
        Left = 126
        Top = 111
        Width = 102
        Height = 17
        Caption = #32593#32476#21517
        Checked = True
        State = cbChecked
        TabOrder = 10
      end
      object CbShowVias: TCheckBox
        Left = 262
        Top = 111
        Width = 87
        Height = 17
        Caption = #36807#23380
        Checked = True
        State = cbChecked
        TabOrder = 11
      end
      object CbShowNativeLabels: TCheckBox
        Left = 14
        Top = 143
        Width = 102
        Height = 17
        Caption = #21407#29983#20301#21495
        Checked = True
        State = cbChecked
        TabOrder = 12
      end
      object CbShowNoBom: TCheckBox
        Left = 126
        Top = 143
        Width = 158
        Height = 17
        Caption = #26174#31034' No BOM '#20803#20214
        TabOrder = 13
      end
        object TTrackBarRotation: TXPTrackBar
        Left = 8
        Top = 191
        Width = 415
        Height = 20
        Max = 72
        Position = 36
        SelEnd = 0
        SelStart = 0
        TabOrder = 14
        OnChange = TTrackBarRotationChange
      end
      object GroupBox5: TGroupBox
        Left = 7
        Top = 219
        Width = 413
        Height = 58
        Caption = #33258#23450#20041#21246#36873#26694
        TabOrder = 15
        object TEditHtmlCheckboxes: TEdit
          Left = 13
          Top = 24
          Width = 304
          Height = 21
          TabOrder = 0
          Text = 'Sourced,Placed'
        end
      end
      object StaticText2: TStaticText
        Left = 16
        Top = 175
        Width = 73
        Height = 17
        Caption = #26495#26059#36716
        TabOrder = 16
      end
      object TTextRotation: TStaticText
        Left = 130
        Top = 175
        Width = 15
        Height = 17
        Caption = '0'#176
        TabOrder = 17
      end
      object GroupBox6: TGroupBox
        Left = 7
        Top = 285
        Width = 413
        Height = 58
        Caption = 'BOM '#35270#22270
        TabOrder = 18
        object RBtnBomOnly: TRadioButton
          Left = 14
          Top = 28
          Width = 113
          Height = 17
          Caption = #20165' BOM'
          TabOrder = 0
        end
        object RBtnBomLeftDrawingRight: TRadioButton
          Left = 110
          Top = 28
          Width = 135
          Height = 17
          Caption = 'BOM '#24038#65292#22270#21491
          Checked = True
          TabOrder = 1
          TabStop = True
        end
        object RBtnBomTopDrawingBottom: TRadioButton
          Left = 254
          Top = 28
          Width = 151
          Height = 17
          Caption = 'BOM '#19978#65292#22270#19979
          TabOrder = 2
        end
      end
      object GroupBox7: TGroupBox
        Left = 7
        Top = 351
        Width = 413
        Height = 58
        Caption = #23618#35270#22270
        TabOrder = 19
        object RBtnFrontAndBack: TRadioButton
          Left = 110
          Top = 28
          Width = 113
          Height = 17
          Caption = #27491#21453#38754
          Checked = True
          TabOrder = 0
          TabStop = True
        end
        object RBtnFrontOnly: TRadioButton
          Left = 14
          Top = 28
          Width = 79
          Height = 17
          Caption = #20165#27491#38754
          TabOrder = 1
        end
        object RBtnBackOnly: TRadioButton
          Left = 254
          Top = 28
          Width = 113
          Height = 17
          Caption = #20165#21453#38754
          TabOrder = 2
        end
      end
    end
  end
  object SaveDialog1: TSaveDialog
    DefaultExt = '.html'
    Filter = 'HTML '#25991#20214' (*.html)|*.HTML|'#25991#26412#25991#20214' (*.txt)|*.TXT|'#25152#26377#25991#20214' (*.*)|*.*'
    Left = 392
    Top = 96
  end
end
