# Math

MdBook supports math through the katex library. You can use inline math using latex syntax `$f(x) = x^2$` resulting in $f(x) = x^2$.

For blocks of math, use the `math` language in a code block:

    ```math
    f\relax{x} = \int_{-\infty}^\infty
        f\hat\xi\,e^{2 \pi i \xi x}
        \,d\xi
    ```

```math
f\relax{x} = \int_{-\infty}^\infty
    f\hat\xi\,e^{2 \pi i \xi x}
    \,d\xi
```
