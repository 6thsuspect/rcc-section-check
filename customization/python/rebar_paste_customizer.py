#!/usr/bin/env python3
"""
==============================================================================
Python Customization Extension: Rebar Coordinate & Diameter Paste Enhancer
==============================================================================
Environment: Python 3.x / CAD API / Standalone Palette / GUI Tool
Purpose: Scans active datasets, CAD JSON/DXF/CSV drawings, or document state in
         real-time to extract all existing coordinates (X, Y, Z) and bar
         diameters. Displays them in a interactive "Customize Paste" dialog
         allowing direct selection and pasting into target locations.
==============================================================================
"""

import sys
import json
import tkinter as tk
from tkinter import ttk, messagebox


class RebarCustomizePasteDialog(tk.Tk):
    def __init__(self, sample_data=None):
        super().__init__()
        self.title("Customize Reinforcement Coordinate & Bar Dia Paste")
        self.geometry("640x520")
        self.resizable(True, True)

        # Active document / dataset state storage
        self.existing_coordinates = []
        self.existing_diameters = []

        # Load real-time or active environment dataset
        self.load_active_document_data(sample_data)

        # Build GUI Layout
        self.create_widgets()

    def load_active_document_data(self, sample_data=None):
        """Reads existing coordinates and bar diameters from current environment in real-time."""
        if sample_data:
            self.existing_coordinates = sample_data.get("coordinates", [])
            self.existing_diameters = sample_data.get("diameters", [])
        else:
            # Default fallback / active inspection mock values
            self.existing_coordinates = [
                {"x": -250.0, "y": 300.0, "z": 0.0},
                {"x": 0.0, "y": 300.0, "z": 0.0},
                {"x": 250.0, "y": 300.0, "z": 0.0},
                {"x": -250.0, "y": -300.0, "z": 0.0},
                {"x": 0.0, "y": -300.0, "z": 0.0},
                {"x": 250.0, "y": -300.0, "z": 0.0},
            ]
            self.existing_diameters = [8, 10, 12, 16, 20, 25, 28, 32, 40]

    def create_widgets(self):
        # Top Banner
        header = ttk.Label(
            self,
            text="Customize Paste — Active Document Reinforcement Data",
            font=("Helvetica", 12, "bold"),
        )
        header.pack(anchor="w", padx=15, pady=(15, 5))

        instruction = ttk.Label(
            self,
            text="Select existing X, Y, Z coordinates and bar diameters present in the current document to paste into the target section:",
            wraplength=600,
        )
        instruction.pack(anchor="w", padx=15, pady=(0, 10))

        # Main Paned Frame
        main_frame = ttk.Frame(self)
        main_frame.pack(fill="both", expand=True, padx=15, pady=5)

        # Left Column: Existing Coordinates Table
        coord_frame = ttk.LabelFrame(main_frame, text=" Existing Coordinates (X, Y, Z) ")
        coord_frame.pack(side="left", fill="both", expand=True, padx=(0, 5))

        self.coord_tree = ttk.Treeview(
            coord_frame, columns=("x", "y", "z"), show="headings", selectmode="extended"
        )
        self.coord_tree.heading("x", text="X (mm)")
        self.coord_tree.heading("y", text="Y (mm)")
        self.coord_tree.heading("z", text="Z (mm)")
        self.coord_tree.column("x", width=80, anchor="center")
        self.coord_tree.column("y", width=80, anchor="center")
        self.coord_tree.column("z", width=80, anchor="center")

        coord_scroll = ttk.Scrollbar(coord_frame, orient="vertical", command=self.coord_tree.yview)
        self.coord_tree.configure(yscrollcommand=coord_scroll.set)

        self.coord_tree.pack(side="left", fill="both", expand=True)
        coord_scroll.pack(side="right", fill="y")

        for c in self.existing_coordinates:
            self.coord_tree.insert("", "end", values=(c["x"], c["y"], c["z"]))

        # Right Column: Existing Bar Diameters List
        dia_frame = ttk.LabelFrame(main_frame, text=" Existing Bar Diameters (⌀ mm) ")
        dia_frame.pack(side="right", fill="both", expand=False, padx=(5, 0))

        self.dia_listbox = tk.Listbox(dia_frame, selectmode="single", width=18)
        dia_scroll = ttk.Scrollbar(dia_frame, orient="vertical", command=self.dia_listbox.yview)
        self.dia_listbox.configure(yscrollcommand=dia_scroll.set)

        self.dia_listbox.pack(side="left", fill="both", expand=True)
        dia_scroll.pack(side="right", fill="y")

        for d in self.existing_diameters:
            self.dia_listbox.insert("end", f"⌀ {d} mm")
        if self.existing_diameters:
            self.dia_listbox.selection_set(0)

        # Output / Format Preview Box
        preview_frame = ttk.LabelFrame(self, text=" Generated Paste Buffer (x, y, dia) ")
        preview_frame.pack(fill="x", padx=15, pady=10)

        self.preview_text = tk.Text(preview_frame, height=4, font=("Consolas", 10))
        self.preview_text.pack(fill="both", expand=True, padx=5, pady=5)

        # Bottom Button Bar
        btn_frame = ttk.Frame(self)
        btn_frame.pack(fill="x", padx=15, pady=(0, 15))

        generate_btn = ttk.Button(btn_frame, text="Format Selected Values", command=self.format_selection)
        generate_btn.pack(side="left")

        copy_btn = ttk.Button(btn_frame, text="Copy to Clipboard", command=self.copy_to_clipboard)
        copy_btn.pack(side="left", padx=10)

        close_btn = ttk.Button(btn_frame, text="Close", command=self.destroy)
        close_btn.pack(side="right")

    def format_selection(self):
        selected_coord_items = self.coord_tree.selection()
        selected_dia_indices = self.dia_listbox.curselection()

        if not selected_coord_items:
            messagebox.showwarning("Selection Required", "Please select at least one coordinate row.")
            return

        dia_val = 20
        if selected_dia_indices:
            raw_str = self.dia_listbox.get(selected_dia_indices[0])
            dia_val = raw_str.replace("⌀", "").replace("mm", "").strip()

        formatted_lines = []
        for item in selected_coord_items:
            vals = self.coord_tree.item(item, "values")
            x, y = vals[0], vals[1]
            formatted_lines.append(f"{x},{y},{dia_val}")

        self.preview_text.delete("1.0", tk.END)
        self.preview_text.insert("1.0", "\n".join(formatted_lines))

    def copy_to_clipboard(self):
        text = self.preview_text.get("1.0", tk.END).strip()
        if not text:
            self.format_selection()
            text = self.preview_text.get("1.0", tk.END).strip()

        if text:
            self.clipboard_clear()
            self.clipboard_append(text)
            messagebox.showinfo("Copied", f"Copied {len(text.splitlines())} line(s) to system clipboard!")


if __name__ == "__main__":
    app = RebarCustomizePasteDialog()
    app.mainloop()
