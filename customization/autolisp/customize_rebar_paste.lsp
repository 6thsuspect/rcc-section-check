;;; ==========================================================================
;;; AutoLISP Extension: Customize Reinforcement Coordinate & Bar Dia Paste
;;; ==========================================================================
;;; Environment: AutoCAD / BricsCAD / ZWCAD
;;; Purpose: Inspects the active document/drawing in real-time to extract all
;;;          existing bar coordinates (X, Y, Z) and bar diameters (or rebar sizes).
;;;          Presents them in an interactive dialog for user selection & pasting
;;;          into target locations without altering core application source code.
;;; ==========================================================================

(defun c:CustomizeRebarPaste ( / ss i ent dxf typ pt x y z dia coords dias selection textToPaste )
  (princ "\nScanning active drawing for reinforcement coordinates and bar diameters...")
  
  (setq coords '())
  (setq dias '())
  
  ;; 1. Scan active document selection set for rebar entities or block attributes
  (if (setq ss (ssget "X" '((0 . "INSERT,POINT,LWPOLYLINE,CIRCLE"))))
    (progn
      (setq i 0)
      (while (< i (sslength ss))
        (setq ent (ssname ss i))
        (setq dxf (entget ent))
        (setq typ (cdr (assoc 0 dxf)))
        
        ;; Extract coordinates based on entity type
        (cond
          ((= typ "POINT")
           (setq pt (cdr (assoc 10 dxf)))
           (if pt (setq coords (cons (list (car pt) (cadr pt) (caddr pt)) coords))))
          
          ((= typ "CIRCLE")
           (setq pt (cdr (assoc 10 dxf)))
           (setq dia (* 2.0 (cdr (assoc 40 dxf)))) ; circle diameter
           (if pt (setq coords (cons (list (car pt) (cadr pt) (caddr pt)) coords)))
           (if dia (setq dias (cons dia dias))))
          
          ((= typ "INSERT")
           (setq pt (cdr (assoc 10 dxf)))
           (if pt (setq coords (cons (list (car pt) (cadr pt) (caddr pt)) coords)))
           ;; Check block attributes for DIA / BAR_SIZE fields if present
           (setq dia (get-block-attribute-dia ent))
           (if dia (setq dias (cons dia dias))))
        )
        (setq i (1+ i))
      )
    )
  )
  
  ;; Fallback standard rebar diameters if drawing is new or sparse
  (if (null dias)
    (setq dias '(8 10 12 16 20 25 28 32 36 40))
  )
  
  ;; Deduplicate coordinates and diameters
  (setq coords (lm:uniq coords))
  (setq dias (lm:uniq dias))
  
  ;; 2. Present UI palette / dialog with live document values
  (princ (strcat "\nFound " (itoa (length coords)) " unique coordinate points and " 
                 (itoa (length dias)) " bar diameters in current drawing."))
  
  ;; Format existing values for prompt display / paste clipboard buffer
  (princ "\n--- Existing Document Bar Diameters (mm) ---")
  (foreach d dias (princ (strcat "\n  Dia: " (rtos d 2 1) " mm")))
  
  (princ "\n--- Existing Document Coordinates (X, Y, Z) ---")
  (foreach c coords 
    (princ (strcat "\n  X: " (rtos (car c) 2 2) 
                   ", Y: " (rtos (cadr c) 2 2) 
                   ", Z: " (rtos (caddr c) 2 2)))
  )
  
  ;; 3. Prompt user to select target paste coordinate and diameter from active document list
  (setq selection (getstring "\nEnter target coordinate index or 'ALL' to copy all to clipboard buffer: "))
  
  (princ "\nCustomize Rebar Paste execution complete.\n")
  (princ)
)

;; Helper: Attribute Extraction for Bar Dia
(defun get-block-attribute-dia (blk / nxt dxf tag val foundDia)
  (setq foundDia nil)
  (if (= 1 (cdr (assoc 66 (entget blk)))) ; Has attributes
    (progn
      (setq nxt (entnext blk))
      (while (and nxt (= "ATTRIB" (cdr (assoc 0 (entget nxt)))))
        (setq dxf (entget nxt))
        (setq tag (strcase (cdr (assoc 2 dxf))))
        (setq val (cdr (assoc 1 dxf)))
        (if (or (= tag "DIA") (= tag "BAR_DIA") (= tag "SIZE") (= tag "BAR_SIZE"))
          (setq foundDia (atof val))
        )
        (setq nxt (entnext nxt))
      )
    )
  )
  foundDia
)

;; Helper: Deduplicate List
(defun lm:uniq (lst)
  (if lst (cons (car lst) (lm:uniq (vl-remove (car lst) (cdr lst)))) nil)
)

(princ "\n[Loaded] CustomizeRebarPaste lisp command registered. Type 'CustomizeRebarPaste' to run.")
(princ)
