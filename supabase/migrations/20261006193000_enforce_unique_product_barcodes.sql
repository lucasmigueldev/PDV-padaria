CREATE UNIQUE INDEX products_barcode_trimmed_unique_idx
    ON public.products (btrim(barcode));
