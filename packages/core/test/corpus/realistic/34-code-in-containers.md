# Code in containers

> A quoted command:
>
> ```sh
> git log --oneline
>
> git status
> ```

1. Install the tools:

   ````bash title="setup.sh"
   pnpm install
   ````

2. Run the checks, indented under the item:

       pnpm test
       pnpm lint

- A tilde fence indented by two spaces:

    ~~~ yaml
    key: value
    ~~~

  ```
  ```

Tabs inside a fence:

```go
func main() {
	fmt.Println("tab")
}
```
