-- Biggie Farma (26/11, Facundo): el código de almacén va también en el nombre, para buscarlo y verlo en la ruta:
-- «Biggie Farma Bruno Guggiari Pinoza» → «Biggie Farma F124 Bruno Guggiari Pinoza». El código sale de las notas (0047).
update vis_clientes
set razon_social = 'Biggie Farma ' || substring(notas from 'Cód\. almacén (F[0-9]+)') || ' ' || substring(razon_social from length('Biggie Farma ') + 1)
where razon_social like 'Biggie Farma %'
  and notas ~ 'Cód\. almacén F[0-9]+'
  and razon_social !~ '^Biggie Farma F[0-9]+ ';
