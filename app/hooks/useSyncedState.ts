import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * Stare locală care pornește de la o valoare primită (de ex. lista din pagină) și poate fi modificată local (actualizări optimiste), dar se aliniază din nou la valoare
 * când aceasta se schimbă (după `router.refresh()`, altă pagină de date etc.). Înlocuiește tiparul `useState(x)` + `useEffect(() => setState(x), [x])`: aliniere în timpul
 * randării (modelul recomandat de React), fără o randare în plus cu valoarea veche și fără `setState` direct într-un efect.
 */
export function useSyncedState<T>(value: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(value);
  const [seen, setSeen] = useState(value);
  if (!Object.is(seen, value)) {
    setSeen(value);
    setState(value);
  }
  return [state, setState];
}
